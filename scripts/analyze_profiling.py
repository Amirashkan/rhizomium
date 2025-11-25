#!/usr/bin/env python3
"""
Profiling Analysis Script
Analyzes performance logs from different workload scenarios and generates metrics.
"""

import json
from pathlib import Path
from collections import defaultdict
from statistics import mean, median, stdev
from typing import Dict, List, Any

def load_log_file(filepath: Path) -> Dict[str, Any]:
    """Load and parse a log file, handling double-encoded JSON."""
    raw = filepath.read_text()
    data = json.loads(raw)
    
    # Handle double-encoded JSON
    depth = 0
    while isinstance(data, str) and depth < 5:
        data = json.loads(data)
        depth += 1
    
    return data

def calculate_frame_statistics(frame_logs: List[Dict]) -> Dict[str, Any]:
    """Calculate statistics from frame logs."""
    if not frame_logs:
        return {}
    
    frame_times = [f.get('totalTime', 0) for f in frame_logs]
    canvas_times = []
    gpu_times = []
    
    for frame in frame_logs:
        systems = frame.get('systems', {})
        if 'canvas' in systems:
            canvas_times.extend(systems['canvas'].get('times', []))
        if 'gpu' in systems:
            gpu_times.extend(systems['gpu'].get('times', []))
    
    def percentile(data: List[float], p: float) -> float:
        if not data:
            return 0.0
        sorted_data = sorted(data)
        index = int(len(sorted_data) * p / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    stats = {
        'count': len(frame_times),
        'frame_time': {
            'mean': mean(frame_times) if frame_times else 0,
            'median': median(frame_times) if frame_times else 0,
            'min': min(frame_times) if frame_times else 0,
            'max': max(frame_times) if frame_times else 0,
            'p50': percentile(frame_times, 50),
            'p75': percentile(frame_times, 75),
            'p90': percentile(frame_times, 90),
            'p95': percentile(frame_times, 95),
            'p99': percentile(frame_times, 99),
        },
        'canvas_time': {
            'mean': mean(canvas_times) if canvas_times else 0,
            'median': median(canvas_times) if canvas_times else 0,
            'p95': percentile(canvas_times, 95),
        } if canvas_times else {},
        'gpu_time': {
            'mean': mean(gpu_times) if gpu_times else 0,
            'median': median(gpu_times) if gpu_times else 0,
            'p95': percentile(gpu_times, 95),
        } if gpu_times else {},
    }
    
    return stats

def analyze_interaction_frames(frame_logs: List[Dict], interaction_type: str) -> Dict[str, Any]:
    """Analyze frames during a specific interaction type."""
    interaction_frames = []
    
    for frame in frame_logs:
        state = frame.get('interactionState', {})
        is_active = state.get(f'is{interaction_type.capitalize()}', False)
        if is_active:
            interaction_frames.append(frame)
    
    if not interaction_frames:
        return {}
    
    return calculate_frame_statistics(interaction_frames)

def analyze_scenario(filepath: Path, scenario_name: str) -> Dict[str, Any]:
    """Analyze a single scenario's log file."""
    print(f"Analyzing {scenario_name}...")
    
    try:
        data = load_log_file(filepath)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return {}
    
    frame_logs = data.get('frameLogs', [])
    stats = data.get('stats', {})
    
    # Calculate frame statistics
    frame_stats = calculate_frame_statistics(frame_logs)
    
    # Analyze interaction-specific frames
    panning_stats = analyze_interaction_frames(frame_logs, 'Panning')
    dragging_stats = analyze_interaction_frames(frame_logs, 'Dragging')
    
    # Calculate system time breakdown
    system_breakdown = defaultdict(lambda: {'total': 0, 'count': 0, 'times': []})
    
    for frame in frame_logs:
        systems = frame.get('systems', {})
        for system_name, system_data in systems.items():
            system_breakdown[system_name]['total'] += system_data.get('total', 0)
            system_breakdown[system_name]['count'] += system_data.get('count', 0)
            system_breakdown[system_name]['times'].extend(system_data.get('times', []))
    
    breakdown_summary = {}
    for system_name, data in system_breakdown.items():
        breakdown_summary[system_name] = {
            'total_time': data['total'],
            'call_count': data['count'],
            'avg_time': data['total'] / data['count'] if data['count'] > 0 else 0,
            'p95_time': sorted(data['times'])[int(len(data['times']) * 0.95)] if data['times'] else 0,
        }
    
    return {
        'scenario': scenario_name,
        'summary_stats': stats,
        'frame_statistics': frame_stats,
        'panning_stats': panning_stats,
        'dragging_stats': dragging_stats,
        'system_breakdown': breakdown_summary,
        'frame_log_count': len(frame_logs),
    }

def main():
    """Main analysis function."""
    base_path = Path('docs/profiling/2025-11-25')
    
    scenarios = [
        ('node_drag_logs.json', 'Node Drag'),
        ('PanZoomLog.json', 'Pan/Zoom'),
        ('param_scrub_logs.json', 'Parameter Scrub'),
        ('save_load_logs.json', 'Save/Load'),
        ('undo_redo_logs.json', 'Undo/Redo'),
        ('idle_warmup_logs.json', 'Idle Warmup'),
    ]
    
    results = []
    
    for filename, scenario_name in scenarios:
        filepath = base_path / filename
        if filepath.exists():
            result = analyze_scenario(filepath, scenario_name)
            if result:
                results.append(result)
        else:
            print(f"Warning: {filepath} not found")
    
    # Save results
    output_path = base_path / 'analysis_results.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nAnalysis complete! Results saved to {output_path}")
    print(f"Analyzed {len(results)} scenarios")
    
    # Print summary
    print("\n=== Summary ===")
    for result in results:
        stats = result.get('summary_stats', {})
        frame_stats = result.get('frame_statistics', {})
        ft = frame_stats.get('frame_time', {})
        print(f"\n{result['scenario']}:")
        print(f"  Total frames: {stats.get('totalFrames', 0):,}")
        print(f"  Frame log samples: {result.get('frame_log_count', 0)}")
        print(f"  Avg frame time: {ft.get('mean', 0):.2f}ms")
        print(f"  P95 frame time: {ft.get('p95', 0):.2f}ms")

if __name__ == '__main__':
    main()

