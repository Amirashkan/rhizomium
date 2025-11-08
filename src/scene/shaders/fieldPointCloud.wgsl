/**
 * Field Point Cloud Generator
 *
 * Generates point cloud from 2D/3D field data
 * Each invocation checks a field cell and outputs a point if value > threshold
 */

struct Params {
    dimensions: vec3<u32>,      // Field dimensions [width, height, depth]
    threshold: f32,             // Minimum value to generate point

    fieldMin: vec3<f32>,        // Field bounds min
    fieldMax: vec3<f32>,        // Field bounds max

    colorMode: u32,             // 0=solid, 1=gradient, 2=field
    colorScale: vec2<f32>,      // Map field values from this range

    colorA: vec4<f32>,          // Color at min value
    colorB: vec4<f32>,          // Color at max value
    solidColor: vec4<f32>,      // Solid color

    displacementScale: f32,     // Displacement amount
    displacementAxis: vec3<f32>, // Displacement direction

    sampleRate: u32,            // Sample every N cells
    _padding: f32,
}

struct Point {
    position: vec3<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var fieldTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> points: array<Point>;
@group(0) @binding(3) var<storage, read_write> counter: atomic<u32>;

fn calculateColor(value: f32) -> vec4<f32> {
    if (params.colorMode == 0u) {
        return params.solidColor;
    }

    // Normalize value to 0-1 range
    let t = (value - params.colorScale.x) / (params.colorScale.y - params.colorScale.x);
    let clamped = clamp(t, 0.0, 1.0);

    // Interpolate between colorA and colorB
    return mix(params.colorA, params.colorB, clamped);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x * params.sampleRate;
    let y = global_id.y * params.sampleRate;

    // Check bounds
    if (x >= params.dimensions.x || y >= params.dimensions.y) {
        return;
    }

    // Sample field texture
    let value = textureLoad(fieldTexture, vec2<i32>(i32(x), i32(y)), 0).r;

    // Threshold test
    if (value <= params.threshold) {
        return;
    }

    // Calculate world position
    let t = vec3<f32>(
        f32(x) / f32(params.dimensions.x),
        f32(y) / f32(params.dimensions.y),
        0.0
    );

    var worldPos = params.fieldMin + t * (params.fieldMax - params.fieldMin);

    // Apply displacement
    let displacement = value * params.displacementScale;
    worldPos += params.displacementAxis * displacement;

    // Calculate color
    let color = calculateColor(value);

    // Atomically allocate a point slot
    let index = atomicAdd(&counter, 1u);

    // Store point data
    points[index].position = worldPos;
    points[index].color = color;
}
