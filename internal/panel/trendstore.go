package panel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// TrendStore 趋势数据的本地持久化：按小时合并累积，重启后不丢失。
// 与 Swift TrendStore 对应，文件位置为 <用户配置目录>/deepseek-panel/trend.json。
type TrendStore struct {
	mu    sync.Mutex
	cache map[int64]TrendPoint
	path  string
}

// NewTrendStore 创建趋势存储并加载磁盘数据。
func NewTrendStore(configDir string) *TrendStore {
	s := &TrendStore{
		cache: map[int64]TrendPoint{},
		path:  filepath.Join(configDir, "deepseek-panel", "trend.json"),
	}
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	s.loadFromDisk()
	return s
}

// SetPath 测试用：替换存储路径。
func (s *TrendStore) SetPath(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.path = path
	s.cache = map[int64]TrendPoint{}
	s.loadFromDisk()
}

func (s *TrendStore) loadFromDisk() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var points []TrendPoint
	if json.Unmarshal(data, &points) != nil {
		return
	}
	for _, p := range points {
		s.cache[p.Time] = p
	}
}

// Points 返回全部按时间排序的点。
func (s *TrendStore) Points() []TrendPoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sortedLocked()
}

func (s *TrendStore) sortedLocked() []TrendPoint {
	out := make([]TrendPoint, 0, len(s.cache))
	for _, p := range s.cache {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out
}

func (s *TrendStore) saveLocked() {
	points := s.sortedLocked()
	data, err := json.Marshal(points)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, data, 0o644) != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}

// CoverageCount [start, end) 内已缓存的小时数。
func (s *TrendStore) CoverageCount(start, end int64) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var count int64
	for _, p := range s.cache {
		if p.Time >= start && p.Time < end {
			count++
		}
	}
	return count
}

// ReplaceRange 用新数据整体替换 [start, end) 范围内的小时数据（幂等）。
func (s *TrendStore) ReplaceRange(points []TrendPoint, start, end int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make(map[int64]TrendPoint)
	for t, p := range s.cache {
		if t < start || t >= end {
			next[t] = p
		}
	}
	for _, p := range points {
		next[p.Time] = p
	}
	s.cache = next
	s.saveLocked()
}

// ReplaceDay 用新数据整体替换某一天的小时数据（幂等）。
func (s *TrendStore) ReplaceDay(points []TrendPoint, dayStart, dayEnd int64) {
	s.ReplaceRange(points, dayStart, dayEnd)
}
