# Node Reference

This document provides a comprehensive reference for all available nodes in the GLSL Node Editor. Nodes are organized by category and include detailed information about their inputs, outputs, parameters, and functionality.

## Table of Contents

- [Input Nodes](#input-nodes)
- [Output Nodes](#output-nodes)
- [Field Nodes](#field-nodes)
- [Math Nodes](#math-nodes)
- [Utility Nodes](#utility-nodes)
- [Blend Nodes](#blend-nodes)
- [Transform Nodes](#transform-nodes)

---

## Input Nodes

Input nodes provide constant values, runtime data sources, and texture sampling capabilities.

### Constant Values

#### Float
Outputs a single constant floating-point value.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `out` (f32) - The constant float value
- **Parameters**:
  - `Value` (float, default: 0.0) - The constant value to output

#### Vec2
Outputs a constant 2D vector.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `out` (vec2) - The constant 2D vector
- **Parameters**:
  - `X` (float, default: 0.0) - X component
  - `Y` (float, default: 0.0) - Y component

#### Vec3
Outputs a constant 3D vector.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `out` (vec3) - The constant 3D vector
- **Parameters**:
  - `X` (float, default: 0.0) - X component
  - `Y` (float, default: 0.0) - Y component
  - `Z` (float, default: 0.0) - Z component

#### Vec4
Outputs a constant 4D vector.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `out` (vec4) - The constant 4D vector
- **Parameters**:
  - `X` (float, default: 0.0) - X component
  - `Y` (float, default: 0.0) - Y component
  - `Z` (float, default: 0.0) - Z component
  - `W` (float, default: 1.0) - W component

### Runtime Inputs

#### UV
Provides the current fragment's UV coordinates.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `uv` (vec2) - UV coordinates (0-1 range)
- **Parameters**: None
- **Description**: Outputs the current pixel's texture coordinates, typically used as input for sampling textures or generating procedural patterns.

#### Time
Provides the current elapsed time.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `t` (f32) - Elapsed time in seconds
- **Parameters**: None
- **Description**: Outputs continuously increasing time value, useful for animations and time-based effects.

#### Mouse
Provides the current mouse position.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `pos` (vec2) - Mouse position as 2D vector
  - `x` (f32) - Mouse X coordinate
  - `y` (f32) - Mouse Y coordinate
- **Parameters**: None
- **Description**: Outputs the current mouse cursor position, normalized to the viewport.

#### Resolution
Provides information about the current viewport resolution.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `res` (vec2) - Resolution as 2D vector (width, height)
  - `width` (f32) - Viewport width in pixels
  - `height` (f32) - Viewport height in pixels
  - `aspect` (f32) - Aspect ratio (width/height)
- **Parameters**: None
- **Description**: Outputs various resolution metrics useful for aspect-correct scaling and responsive effects.

#### Pi
Provides the mathematical constant Pi.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `pi` (f32) - The value of Pi (3.14159...)
- **Parameters**: None
- **Description**: Outputs the constant π, useful for trigonometric calculations.

#### Random Time
Generates a time-varying random value.

- **Category**: Input
- **Inputs**: None
- **Outputs**:
  - `rand` (f32) - Random value that changes over time
- **Parameters**:
  - `Speed` (float, default: 1.0) - Rate of random value change
- **Description**: Outputs a pseudo-random value that evolves over time, useful for animated noise effects.

#### Trigger
Converts a continuous value into a pulse trigger.

- **Category**: Input
- **Inputs**:
  - `value` (f32) - Input value to monitor
- **Outputs**:
  - `pulse` (f32) - Trigger pulse output (0 or 1)
- **Parameters**:
  - `Threshold` (float, default: 0.5) - Activation threshold
- **Description**: Outputs a pulse when the input crosses the threshold, useful for creating discrete events from continuous signals.

#### Hold
Samples and holds an input value when triggered.

- **Category**: Input
- **Inputs**:
  - `value` (f32) - Value to sample
  - `pulse` (f32) - Trigger signal
- **Outputs**:
  - `out` (f32) - Held value
- **Parameters**:
  - `Threshold` (float, default: 0.5) - Trigger threshold
- **Description**: Captures and holds the input value when the pulse signal crosses the threshold.

### Texture Sampling

#### Texture 2D
Samples a 2D texture image.

- **Category**: Input
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `RGBA` (vec4) - Full color with alpha
  - `RGB` (vec3) - Color channels only
  - `R` (f32) - Red channel
  - `G` (f32) - Green channel
  - `B` (f32) - Blue channel
  - `A` (f32) - Alpha channel
- **Parameters**:
  - `Image` (file) - Image file to load
  - `Wrap U` (select: repeat/clamp/mirror, default: repeat) - Horizontal wrapping mode
  - `Wrap V` (select: repeat/clamp/mirror, default: repeat) - Vertical wrapping mode
  - `Filter` (select: linear/nearest, default: linear) - Texture filtering mode
- **Description**: Loads and samples a 2D texture image at the given UV coordinates, with configurable wrapping and filtering.

#### Texture Cube
Samples a cubemap texture.

- **Category**: Input
- **Inputs**:
  - `Dir` - Direction vector for sampling
- **Outputs**:
  - `RGBA` (vec4) - Full color with alpha
  - `RGB` (vec3) - Color channels only
  - `A` (f32) - Alpha channel
- **Parameters**:
  - `Cubemap` (file) - Cubemap image file
  - `Filter` (select: linear/nearest, default: linear) - Texture filtering mode
- **Description**: Samples a cubemap texture using a 3D direction vector, commonly used for environment mapping.

---

## Output Nodes

Output nodes define the final result of the shader graph.

### Output
The final output node for the shader.

- **Category**: Output
- **Inputs**:
  - `color` - The final color value to output
- **Outputs**: None
- **Parameters**: None
- **Description**: Defines the final pixel color that will be rendered to the screen. Every shader graph must have exactly one Output node.

---

## Field Nodes

Field nodes generate procedural patterns, gradients, shapes, and noise functions.

### Gradients

#### Linear Gradient
Generates a linear gradient pattern.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `Value` - Gradient value (0-1)
- **Parameters**:
  - `angle` (float, default: 0.0) - Gradient rotation angle
  - `offset` (float, default: 0.0) - Gradient offset
  - `scale` (float, default: 1.0) - Gradient scale
  - `repeat` (boolean, default: false) - Enable gradient repetition
- **Description**: Creates a linear gradient that can be rotated, scaled, and optionally repeated across the surface.

#### Radial Gradient
Generates a radial gradient pattern.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `Value` - Gradient value (0-1)
- **Parameters**:
  - `centerX` (float, default: 0.5) - Center X position
  - `centerY` (float, default: 0.5) - Center Y position
  - `radius` (float, default: 0.5) - Gradient radius
  - `falloff` (float, default: 1.0) - Falloff exponent
  - `invert` (boolean, default: false) - Invert gradient direction
- **Description**: Creates a circular gradient emanating from a center point with controllable falloff.

#### Angular Gradient
Generates an angular (circular sweep) gradient.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `Value` - Gradient value (0-1)
- **Parameters**:
  - `centerX` (float, default: 0.5) - Center X position
  - `centerY` (float, default: 0.5) - Center Y position
  - `rotation` (float, default: 0.0) - Rotation offset
  - `repeat` (float, default: 1.0) - Number of repetitions
- **Description**: Creates a gradient that sweeps around a center point in a circular motion.

#### Conic Gradient
Generates a conic gradient with angular range control.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `Value` - Gradient value (0-1)
- **Parameters**:
  - `centerX` (float, default: 0.5) - Center X position
  - `centerY` (float, default: 0.5) - Center Y position
  - `startAngle` (float, default: 0.0) - Starting angle in radians
  - `endAngle` (float, default: 6.28318) - Ending angle in radians
  - `smoothness` (float, default: 0.0) - Edge smoothing amount
- **Description**: Creates a gradient that sweeps between specified start and end angles with smooth transitions.

#### Color Ramp
Maps values to colors using a gradient with control points.

- **Category**: Field
- **Inputs**:
  - `Value` - Input value to map (0-1)
- **Outputs**:
  - `Color` - Resulting color
- **Parameters**:
  - `stops` (colorstops) - Color gradient stops with positions
  - `mode` (select: Linear/Step/Smooth, default: Linear) - Interpolation mode
- **Description**: Converts scalar values into colors by interpolating through a user-defined color gradient with multiple control points.

### Pattern Generators

#### Checker
Generates a checkerboard pattern.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Pattern value (0 or 1)
- **Parameters**:
  - `Scale X` (float, default: 8.0) - Horizontal tile count
  - `Scale Y` (float, default: 8.0) - Vertical tile count
  - `Smoothness` (float, default: 0.0) - Edge antialiasing amount
- **Description**: Creates an alternating checkerboard pattern with adjustable grid size and optional smoothing.

#### Stripe
Generates parallel stripe patterns.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Pattern value (0-1)
- **Parameters**:
  - `Frequency` (float, default: 5.0) - Number of stripes
  - `Angle` (float, default: 0.0) - Stripe rotation angle
  - `Thickness` (float, default: 0.5) - Stripe width ratio
  - `Smoothness` (float, default: 0.0) - Edge antialiasing
- **Description**: Creates parallel stripes that can be rotated, with adjustable frequency and thickness.

### Shape Generators

#### Circle
Generates a circular shape or distance field.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Shape value (0 inside, 1 outside)
- **Parameters**:
  - `Center X` (float, default: 0.5) - Circle center X
  - `Center Y` (float, default: 0.5) - Circle center Y
  - `Radius` (float, default: 0.25) - Circle radius
  - `Smoothness` (float, default: 0.01) - Edge softness
  - `Invert` (bool, default: false) - Invert inside/outside
- **Description**: Creates a circular shape with smooth edges, can be used as a mask or distance field.

#### Rectangle
Generates a rectangular shape.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Shape value (0 inside, 1 outside)
- **Parameters**:
  - `Center X` (float, default: 0.5) - Rectangle center X
  - `Center Y` (float, default: 0.5) - Rectangle center Y
  - `Width` (float, default: 0.5) - Rectangle width
  - `Height` (float, default: 0.5) - Rectangle height
  - `Roundness` (float, default: 0.0) - Corner rounding amount
  - `Smoothness` (float, default: 0.01) - Edge softness
  - `Invert` (bool, default: false) - Invert inside/outside
- **Description**: Creates a rectangular shape with optional rounded corners and smooth edges.

#### Polygon
Generates a regular polygon shape.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Shape value (0 inside, 1 outside)
- **Parameters**:
  - `Center X` (float, default: 0.5) - Polygon center X
  - `Center Y` (float, default: 0.5) - Polygon center Y
  - `Sides` (int, default: 6) - Number of sides
  - `Radius` (float, default: 0.25) - Polygon radius
  - `Rotation` (float, default: 0.0) - Rotation angle
  - `Smoothness` (float, default: 0.01) - Edge softness
  - `Invert` (bool, default: false) - Invert inside/outside
- **Description**: Creates regular polygons (triangle, hexagon, etc.) with adjustable sides, rotation, and smooth edges.

### Noise Functions

#### Random
Generates pseudo-random values.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Random value
- **Parameters**:
  - `Seed` (float, default: 1.0) - Random seed value
  - `Scale` (float, default: 1.0) - Scale of randomness
- **Description**: Generates pseudo-random values based on UV coordinates, useful for adding randomness to patterns.

#### Value Noise
Generates smooth value noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Noise value
- **Parameters**:
  - `Scale` (float, default: 5.0) - Noise frequency
  - `Amplitude` (float, default: 1.0) - Noise intensity
  - `Offset` (float, default: 0.0) - Value offset
  - `Power` (float, default: 1.0) - Power curve adjustment
- **Description**: Simple interpolated noise between random values at grid points.

#### Perlin Noise
Generates classic Perlin gradient noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Noise value
- **Parameters**:
  - `Scale` (float, default: 5.0) - Noise frequency
  - `Amplitude` (float, default: 1.0) - Noise intensity
  - `Offset` (float, default: 0.0) - Value offset
- **Description**: Classic Perlin noise algorithm producing smooth, natural-looking noise patterns.

#### Simplex Noise
Generates Simplex noise with optional variations.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Noise value
- **Parameters**:
  - `Scale` (float, default: 4.0) - Noise frequency
  - `Amplitude` (float, default: 1.0) - Noise intensity
  - `Offset` (float, default: 0.0) - Value offset
  - `Ridge Mode` (bool, default: false) - Enable ridge noise
  - `Turbulence` (bool, default: false) - Enable turbulence mode
- **Description**: Modern Simplex noise with better performance than Perlin, includes ridge and turbulence variations.

#### FBM Noise
Generates Fractional Brownian Motion noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Noise value
- **Parameters**:
  - `Scale` (float, default: 3.0) - Base frequency
  - `Octaves` (int, default: 4) - Number of noise layers
  - `Persistence` (float, default: 0.5) - Amplitude decay per octave
  - `Lacunarity` (float, default: 2.0) - Frequency increase per octave
  - `Amplitude` (float, default: 1.0) - Overall intensity
  - `Offset` (float, default: 0.0) - Value offset
  - `Gain` (float, default: 0.5) - Octave gain factor
  - `Warp` (float, default: 0.0) - Domain warping amount
- **Description**: Layered noise with multiple octaves creating complex, natural-looking patterns like clouds or terrain.

#### Voronoi Noise
Generates cellular Voronoi patterns.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `F1` (f32) - Distance to closest cell
  - `F2` (f32) - Distance to second closest cell
  - `cells` (vec2) - Cell center coordinates
- **Parameters**:
  - `Scale` (float, default: 8.0) - Cell density
  - `Randomness` (float, default: 1.0) - Cell point randomization
  - `Distance Type` (float, default: 2.0) - Minkowski distance parameter
  - `Smoothness` (float, default: 0.0) - Cell edge smoothing
  - `Cell Type` (int, default: 0) - Cell pattern variation
  - `Output Type` (int, default: 0) - Output mode selection
- **Description**: Creates cellular patterns based on distances to randomly distributed points, useful for tiles, cells, and stone textures.

#### Ridged Noise
Generates ridged multi-fractal noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Noise value
- **Parameters**:
  - `Scale` (float, default: 4.0) - Base frequency
  - `Octaves` (int, default: 6) - Number of layers
  - `Lacunarity` (float, default: 2.0) - Frequency multiplier
  - `Gain` (float, default: 0.5) - Amplitude multiplier
  - `Amplitude` (float, default: 1.0) - Overall intensity
  - `Offset` (float, default: 1.0) - Ridge offset
  - `Threshold` (float, default: 0.0) - Ridge threshold
- **Description**: Specialized noise creating sharp ridges and valleys, ideal for mountainous terrain.

#### Warp Noise
Generates domain-warped noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Warped noise value
- **Parameters**:
  - `Scale` (float, default: 3.0) - Base noise frequency
  - `Warp Scale` (float, default: 2.0) - Warp noise frequency
  - `Warp Strength` (float, default: 0.1) - Warping intensity
  - `Octaves` (int, default: 3) - Number of noise layers
  - `Amplitude` (float, default: 1.0) - Overall intensity
- **Description**: Applies domain warping to create swirling, organic noise patterns.

### Cell-Based Patterns

#### Worley Noise
Generates Worley (cellular) noise.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `F1` (f32) - Distance to nearest point
  - `F2` (f32) - Distance to second nearest point
  - `Combined` (f32) - Combined distance metric
- **Parameters**:
  - `Scale` (float, default: 8.0) - Point density
  - `Jitter` (float, default: 1.0) - Point randomization
  - `Distance Metric` (select: euclidean/manhattan/chebyshev/minkowski, default: euclidean) - Distance calculation method
  - `Minkowski P` (float, default: 2.0) - Minkowski distance parameter
- **Description**: Creates cellular patterns based on distances to random points using various distance metrics.

#### Cell Noise
Generates simple cell-based patterns.

- **Category**: Field
- **Inputs**:
  - `UV` - Texture coordinates
- **Outputs**:
  - `out` (f32) - Cell pattern value
  - `cellID` (vec2) - Cell identifier coordinates
- **Parameters**:
  - `Scale` (float, default: 8.0) - Cell density
  - `Randomness` (float, default: 1.0) - Cell value variation
  - `Smooth` (bool, default: false) - Enable smooth interpolation
- **Description**: Simple cellular pattern generator with optional smoothing and cell identification output.

### Field Utilities

#### Displacement
Displaces UV coordinates based on an offset field.

- **Category**: Field
- **Inputs**:
  - `UV` - Base texture coordinates
  - `Offset` - Displacement amount/direction
- **Outputs**:
  - `out` (vec2) - Displaced UV coordinates
- **Parameters**:
  - `Strength` (float, default: 0.2) - Displacement intensity
  - `Center Input` (boolean, default: true) - Center the offset range (-0.5 to 0.5)
  - `Wrap UV` (boolean, default: false) - Wrap coordinates at boundaries
- **Description**: Distorts UV coordinates based on an input field, useful for creating refraction, ripples, or warping effects.

---

## Math Nodes

Math nodes perform mathematical operations on scalar and vector values. Most operations are type-aware and preserve input types.

### Basic Arithmetic

#### Add
Adds two values together.

- **Category**: Math
- **Inputs**:
  - `A` - First value
  - `B` - Second value
- **Outputs**:
  - `out` (dynamic) - A + B
- **Parameters**:
  - `A` (float, default: 0.0) - First value (when not connected)
  - `B` (float, default: 0.0) - Second value (when not connected)
- **Description**: Performs component-wise addition. Works with scalars, vectors, and mixed types.

#### Subtract
Subtracts one value from another.

- **Category**: Math
- **Inputs**:
  - `A` - Minuend
  - `B` - Subtrahend
- **Outputs**:
  - `out` (dynamic) - A - B
- **Parameters**:
  - `A` (float, default: 0.0) - Minuend (when not connected)
  - `B` (float, default: 0.0) - Subtrahend (when not connected)
- **Description**: Performs component-wise subtraction. Works with scalars, vectors, and mixed types.

#### Multiply
Multiplies two values together.

- **Category**: Math
- **Inputs**:
  - `A` - First factor
  - `B` - Second factor
- **Outputs**:
  - `out` (dynamic) - A * B
- **Parameters**:
  - `A` (float, default: 1.0) - First factor (when not connected)
  - `B` (float, default: 1.0) - Second factor (when not connected)
- **Description**: Performs component-wise multiplication. Works with scalars, vectors, and mixed types.

#### Divide
Divides one value by another.

- **Category**: Math
- **Inputs**:
  - `A` - Numerator
  - `B` - Denominator
- **Outputs**:
  - `out` (dynamic) - A / B
- **Parameters**:
  - `A` (float, default: 1.0) - Numerator (when not connected)
  - `B` (float, default: 1.0) - Denominator (when not connected)
- **Description**: Performs component-wise division. Works with scalars, vectors, and mixed types.

#### Power
Raises a value to a power.

- **Category**: Math
- **Inputs**:
  - `Base` - Base value
  - `Exp` - Exponent
- **Outputs**:
  - `out` (dynamic) - Base^Exp
- **Parameters**:
  - `Base` (float, default: 1.0) - Base value (when not connected)
  - `Exp` (float, default: 2.0) - Exponent (when not connected)
- **Description**: Raises the base to the power of the exponent. Works component-wise for vectors.

### Trigonometric Functions

#### Sin
Calculates the sine of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value in radians
- **Outputs**:
  - `out` (dynamic) - sin(x)
- **Description**: Computes sine function. Works component-wise for vectors.

#### Cos
Calculates the cosine of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value in radians
- **Outputs**:
  - `out` (dynamic) - cos(x)
- **Description**: Computes cosine function. Works component-wise for vectors.

#### Tan
Calculates the tangent of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value in radians
- **Outputs**:
  - `out` (dynamic) - tan(x)
- **Description**: Computes tangent function. Works component-wise for vectors.

#### Asin
Calculates the arc sine (inverse sine) of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value (-1 to 1)
- **Outputs**:
  - `out` (dynamic) - asin(x)
- **Description**: Computes arc sine, returns angle in radians. Works component-wise for vectors.

#### Acos
Calculates the arc cosine (inverse cosine) of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value (-1 to 1)
- **Outputs**:
  - `out` (dynamic) - acos(x)
- **Description**: Computes arc cosine, returns angle in radians. Works component-wise for vectors.

#### Atan
Calculates the arc tangent (inverse tangent) of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - atan(x)
- **Description**: Computes arc tangent, returns angle in radians. Works component-wise for vectors.

#### Atan2
Calculates the arc tangent of y/x using the signs of both to determine the quadrant.

- **Category**: Math
- **Inputs**:
  - `y` - Y coordinate
  - `x` - X coordinate
- **Outputs**:
  - `out` (dynamic) - atan(y, x)
- **Description**: Two-argument arc tangent, returns angle in radians with correct quadrant. Useful for converting Cartesian to polar coordinates.

### Mathematical Functions

#### Floor
Rounds down to the nearest integer.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - floor(x)
- **Description**: Returns the largest integer less than or equal to x. Works component-wise for vectors.

#### Ceil
Rounds up to the nearest integer.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - ceil(x)
- **Description**: Returns the smallest integer greater than or equal to x. Works component-wise for vectors.

#### Round
Rounds to the nearest integer.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - round(x)
- **Description**: Rounds to the nearest integer value. Works component-wise for vectors.

#### Fract
Returns the fractional part of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - fract(x)
- **Description**: Returns the fractional part (x - floor(x)). Useful for creating repeating patterns.

#### Abs
Returns the absolute value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - abs(x)
- **Description**: Returns the absolute value (removes negative sign). Works component-wise for vectors.

#### Sqrt
Calculates the square root.

- **Category**: Math
- **Inputs**:
  - `x` - Input value (must be non-negative)
- **Outputs**:
  - `out` (dynamic) - sqrt(x)
- **Description**: Returns the square root of x. Works component-wise for vectors.

#### Sign
Returns the sign of a value.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - sign(x)
- **Description**: Returns -1, 0, or 1 depending on whether x is negative, zero, or positive. Works component-wise for vectors.

#### Mod
Returns the modulo (remainder after division).

- **Category**: Math
- **Inputs**:
  - `x` - Dividend
  - `y` - Divisor
- **Outputs**:
  - `out` (dynamic) - mod(x, y)
- **Description**: Returns the remainder of x/y. Works component-wise for vectors.

#### Exp
Calculates e raised to the power of x.

- **Category**: Math
- **Inputs**:
  - `x` - Exponent
- **Outputs**:
  - `out` (dynamic) - e^x
- **Description**: Natural exponential function (base e). Works component-wise for vectors.

#### Exp2
Calculates 2 raised to the power of x.

- **Category**: Math
- **Inputs**:
  - `x` - Exponent
- **Outputs**:
  - `out` (dynamic) - 2^x
- **Description**: Base-2 exponential function. Works component-wise for vectors.

#### Log
Calculates the natural logarithm.

- **Category**: Math
- **Inputs**:
  - `x` - Input value (must be positive)
- **Outputs**:
  - `out` (dynamic) - ln(x)
- **Description**: Natural logarithm (base e). Works component-wise for vectors.

#### Log2
Calculates the base-2 logarithm.

- **Category**: Math
- **Inputs**:
  - `x` - Input value (must be positive)
- **Outputs**:
  - `out` (dynamic) - log2(x)
- **Description**: Base-2 logarithm. Works component-wise for vectors.

### Range and Comparison

#### Min
Returns the minimum of two values.

- **Category**: Math
- **Inputs**:
  - `A` - First value
  - `B` - Second value
- **Outputs**:
  - `out` (dynamic) - min(A, B)
- **Description**: Returns the smaller of two values. Works component-wise for vectors.

#### Max
Returns the maximum of two values.

- **Category**: Math
- **Inputs**:
  - `A` - First value
  - `B` - Second value
- **Outputs**:
  - `out` (dynamic) - max(A, B)
- **Description**: Returns the larger of two values. Works component-wise for vectors.

#### Clamp
Constrains a value between a minimum and maximum.

- **Category**: Math
- **Inputs**:
  - `Value` - Value to clamp
  - `Min` - Minimum bound
  - `Max` - Maximum bound
- **Outputs**:
  - `out` (dynamic) - clamped value
- **Description**: Restricts value to be between min and max. Works component-wise for vectors.

### Interpolation

#### Smoothstep
Performs smooth Hermite interpolation.

- **Category**: Math
- **Inputs**:
  - `Edge0` - Lower edge
  - `Edge1` - Upper edge
  - `X` - Value to interpolate
- **Outputs**:
  - `out` (dynamic) - smoothly interpolated value (0-1)
- **Description**: Smooth interpolation between 0 and 1 when X is between Edge0 and Edge1. Uses Hermite polynomial for smooth transitions.

#### Step
Generates a step function.

- **Category**: Math
- **Inputs**:
  - `Edge` - Step threshold
  - `X` - Value to test
- **Outputs**:
  - `out` (dynamic) - 0 if X < Edge, else 1
- **Description**: Hard step function, useful for creating sharp transitions and thresholds.

#### Mix
Linearly interpolates between two values.

- **Category**: Math
- **Inputs**:
  - `A` - Start value
  - `B` - End value
  - `T` - Interpolation factor (0-1)
- **Outputs**:
  - `out` (dynamic) - interpolated value
- **Description**: Linear interpolation (blend) between A and B. When T=0 returns A, when T=1 returns B.

#### Lerp
Linearly interpolates between two values (alias for Mix).

- **Category**: Math
- **Inputs**:
  - `A` - Start value
  - `B` - End value
  - `T` - Interpolation factor (0-1)
- **Outputs**:
  - `out` (dynamic) - interpolated value
- **Description**: Linear interpolation between A and B. Identical to Mix node.

#### Inverse Lerp
Finds the interpolation factor for a value between two bounds.

- **Category**: Math
- **Inputs**:
  - `A` - Start bound
  - `B` - End bound
  - `Value` - Value to find factor for
- **Outputs**:
  - `out` (f32) - interpolation factor (0-1)
- **Description**: Inverse of lerp - finds what T value would produce Value when lerping between A and B.

#### Saturate
Clamps a value between 0 and 1.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - saturated value (0-1)
- **Description**: Convenient clamp to 0-1 range. Equivalent to clamp(x, 0, 1).

#### One Minus
Subtracts a value from 1.

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - 1 - x
- **Description**: Inverts a value in 0-1 range. Useful for inverting masks and blend factors.

#### Negate
Negates a value (multiplies by -1).

- **Category**: Math
- **Inputs**:
  - `x` - Input value
- **Outputs**:
  - `out` (dynamic) - -x
- **Description**: Flips the sign of a value. Works component-wise for vectors.

#### Reciprocal
Calculates the reciprocal (1/x).

- **Category**: Math
- **Inputs**:
  - `x` - Input value (must be non-zero)
- **Outputs**:
  - `out` (dynamic) - 1/x
- **Description**: Returns the multiplicative inverse. Works component-wise for vectors.

### Vector Math Operations

#### Dot Product
Calculates the dot product of two vectors.

- **Category**: Math
- **Inputs**:
  - `A` - First vector
  - `B` - Second vector
- **Outputs**:
  - `out` (f32) - dot product (scalar)
- **Description**: Computes the dot product (sum of component-wise multiplication). Returns a scalar value representing the projection of one vector onto another.

#### Cross Product
Calculates the cross product of two 3D vectors.

- **Category**: Math
- **Inputs**:
  - `A` - First vector (vec3)
  - `B` - Second vector (vec3)
- **Outputs**:
  - `out` (vec3) - cross product vector
- **Description**: Computes the cross product, returning a vector perpendicular to both inputs. Only works with 3D vectors.

#### Normalize
Normalizes a vector to unit length.

- **Category**: Math
- **Inputs**:
  - `Vec` - Vector to normalize
- **Outputs**:
  - `out` (dynamic) - normalized vector
- **Description**: Returns a vector with the same direction but length of 1. Essential for direction vectors and lighting calculations.

#### Length
Calculates the length (magnitude) of a vector.

- **Category**: Math
- **Inputs**:
  - `Vec` - Input vector
- **Outputs**:
  - `out` (f32) - vector length (scalar)
- **Description**: Computes the Euclidean length of a vector. For vec2: sqrt(x*x + y*y), for vec3: sqrt(x*x + y*y + z*z), etc.

#### Distance
Calculates the distance between two points.

- **Category**: Math
- **Inputs**:
  - `A` - First point
  - `B` - Second point
- **Outputs**:
  - `out` (f32) - distance (scalar)
- **Description**: Computes the Euclidean distance between two vectors. Equivalent to length(A - B).

#### Reflect
Reflects a vector across a normal.

- **Category**: Math
- **Inputs**:
  - `I` - Incident vector
  - `N` - Normal vector (should be normalized)
- **Outputs**:
  - `out` (dynamic) - reflected vector
- **Description**: Reflects the incident vector I across the normal N. Used for mirror reflections and specular lighting.

#### Refract
Refracts a vector through a surface.

- **Category**: Math
- **Inputs**:
  - `I` - Incident vector
  - `N` - Normal vector (should be normalized)
  - `eta` - Ratio of refractive indices
- **Outputs**:
  - `out` (dynamic) - refracted vector
- **Description**: Computes the refraction of vector I through a surface with normal N using Snell's law. Used for glass and transparent materials.

---

## Utility Nodes

Utility nodes provide data manipulation, conversion, and color adjustment capabilities.

### Data Manipulation

#### Expression
Evaluates a custom mathematical expression.

- **Category**: Utility
- **Inputs**:
  - `a` - First input variable
  - `b` - Second input variable
- **Outputs**:
  - `out` (f32) - Expression result
- **Parameters**:
  - `Expression` (expression, default: "a") - Mathematical expression to evaluate
- **Description**: Allows custom mathematical expressions using input variables. Supports standard math operators and functions.

#### Remap
Remaps a value from one range to another.

- **Category**: Utility
- **Inputs**:
  - `Value` - Input value to remap
- **Outputs**:
  - `out` (f32) - Remapped value
- **Parameters**:
  - `In Min` (float, default: 0.0) - Input range minimum
  - `In Max` (float, default: 1.0) - Input range maximum
  - `Out Min` (float, default: 0.0) - Output range minimum
  - `Out Max` (float, default: 1.0) - Output range maximum
  - `Clamp` (bool, default: false) - Clamp output to range
- **Description**: Linearly remaps a value from one numeric range to another. Useful for adjusting value ranges.

#### Posterize
Reduces the number of distinct values.

- **Category**: Utility
- **Inputs**:
  - `Value` - Input value
- **Outputs**:
  - `out` (f32) - Posterized value
- **Parameters**:
  - `Steps` (float, default: 8.0) - Number of discrete steps
- **Description**: Quantizes input values into discrete steps, creating a posterization effect.

### Color Manipulation

#### To Grayscale
Converts a color to grayscale.

- **Category**: Utility
- **Inputs**:
  - `Color` - Input color (vec3)
- **Outputs**:
  - `out` (f32) - Grayscale value
- **Parameters**:
  - `Method` (select: luminance/average/lightness, default: luminance) - Conversion method
- **Description**: Converts RGB color to a single grayscale value using various methods. Luminance uses perceptual weighting (0.299R + 0.587G + 0.114B).

#### Invert Color
Inverts a color.

- **Category**: Utility
- **Inputs**:
  - `Color` - Input color (vec3)
- **Outputs**:
  - `out` (vec3) - Inverted color
- **Description**: Inverts each color channel by computing (1 - color). Creates a negative image effect.

#### Saturate Color
Adjusts color saturation.

- **Category**: Utility
- **Inputs**:
  - `Color` - Input color (vec3)
- **Outputs**:
  - `out` (vec3) - Saturated color
- **Parameters**:
  - `Saturation` (float, default: 1.0) - Saturation amount (0 = grayscale, 1 = normal, >1 = oversaturated)
- **Description**: Adjusts the color saturation. Values below 1 reduce saturation (approaching grayscale), values above 1 increase saturation.

#### Contrast
Adjusts color contrast.

- **Category**: Utility
- **Inputs**:
  - `Color` - Input color (vec3)
- **Outputs**:
  - `out` (vec3) - Adjusted color
- **Parameters**:
  - `Contrast` (float, default: 1.0) - Contrast amount (1 = normal)
  - `Pivot` (float, default: 0.5) - Contrast pivot point
- **Description**: Adjusts contrast by scaling values around a pivot point. Values below 1 reduce contrast, values above 1 increase contrast.

#### Brightness
Adjusts color brightness.

- **Category**: Utility
- **Inputs**:
  - `Color` - Input color (vec3)
- **Outputs**:
  - `out` (vec3) - Brightened color
- **Parameters**:
  - `Brightness` (float, default: 0.0) - Brightness adjustment (negative = darker, positive = brighter)
- **Description**: Adds a constant value to all color channels, making the color brighter or darker.

#### Color Mix
Blends two colors using various blend modes.

- **Category**: Utility
- **Inputs**:
  - `Base` - Base color
  - `Blend` - Blend color
  - `Factor` - Blend factor (0-1)
- **Outputs**:
  - `out` (vec3) - Mixed color
- **Parameters**:
  - `Mode` (select, default: mix) - Blend mode: mix, multiply, screen, overlay, add, subtract, divide, difference, darken, lighten
- **Description**: Combines two colors using various blend modes similar to image editing software.

### Color Space Conversion

#### HSV to RGB
Converts HSV color to RGB.

- **Category**: Utility
- **Inputs**:
  - `HSV` - Input color in HSV space (vec3)
- **Outputs**:
  - `out` (vec3) - RGB color
- **Description**: Converts from HSV (Hue, Saturation, Value) color space to RGB color space.

#### RGB to HSV
Converts RGB color to HSV.

- **Category**: Utility
- **Inputs**:
  - `RGB` - Input color in RGB space (vec3)
- **Outputs**:
  - `out` (vec3) - HSV color
- **Description**: Converts from RGB color space to HSV (Hue, Saturation, Value) color space. Useful for hue-based color adjustments.

### Logic and Selection

#### Select
Selects between two values based on a condition.

- **Category**: Utility
- **Inputs**:
  - `A` - First value
  - `B` - Second value
  - `Condition` - Selection condition
- **Outputs**:
  - `out` (vec3) - Selected value
- **Parameters**:
  - `Threshold` (float, default: 0.5) - Condition threshold
- **Description**: Returns A if Condition < Threshold, otherwise returns B. Useful for creating masks and conditional logic.

#### Compare
Compares two values using various operators.

- **Category**: Utility
- **Inputs**:
  - `A` - First value
  - `B` - Second value
- **Outputs**:
  - `out` (f32) - Comparison result (0 or 1)
- **Parameters**:
  - `Operator` (select: equal/notEqual/greater/greaterEqual/less/lessEqual, default: greater) - Comparison operator
  - `Epsilon` (float, default: 0.001) - Tolerance for equality comparisons
- **Description**: Compares two values using the selected operator. Returns 1.0 if true, 0.0 if false.

---

## Blend Nodes

Blend nodes provide operations for combining signed distance fields (SDFs) and creating constructive solid geometry (CSG) operations.

### SDF Operations

#### Add (SDF)
Adds two signed distance fields.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - First SDF
  - `B` (float) - Second SDF
- **Outputs**:
  - `Result` (float) - Combined SDF
- **Description**: Combines two SDFs by adding their distance values together.

#### Subtract (SDF)
Subtracts one SDF from another.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - Base SDF
  - `B` (float) - SDF to subtract
- **Outputs**:
  - `Result` (float) - Subtracted SDF
- **Description**: CSG subtraction operation - removes B from A. Creates negative space.

#### Union (Min)
Creates a union of two SDFs.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - First SDF
  - `B` (float) - Second SDF
- **Outputs**:
  - `Result` (float) - Union SDF
- **Description**: CSG union operation using minimum. Combines both shapes with a hard edge.

#### Intersection (Max)
Creates an intersection of two SDFs.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - First SDF
  - `B` (float) - Second SDF
- **Outputs**:
  - `Result` (float) - Intersection SDF
- **Description**: CSG intersection operation using maximum. Only shows regions where both shapes overlap.

### Smooth SDF Operations

#### Smooth Union
Creates a smooth union of two SDFs.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - First SDF
  - `B` (float) - Second SDF
- **Outputs**:
  - `Result` (float) - Smooth union SDF
- **Parameters**:
  - `Smoothness` (slider, default: 0.1, range: 0.0-1.0) - Blend smoothness
- **Description**: CSG union with smooth blending between shapes. Creates organic-looking connections.

#### Smooth Intersection
Creates a smooth intersection of two SDFs.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - First SDF
  - `B` (float) - Second SDF
- **Outputs**:
  - `Result` (float) - Smooth intersection SDF
- **Parameters**:
  - `Smoothness` (slider, default: 0.1, range: 0.0-1.0) - Blend smoothness
- **Description**: CSG intersection with smooth blending between shapes.

#### Smooth Subtraction
Creates a smooth subtraction of two SDFs.

- **Category**: Blend
- **Inputs**:
  - `A` (float) - Base SDF
  - `B` (float) - SDF to subtract
- **Outputs**:
  - `Result` (float) - Smooth subtraction SDF
- **Parameters**:
  - `Smoothness` (slider, default: 0.1, range: 0.0-1.0) - Blend smoothness
- **Description**: CSG subtraction with smooth blending at edges. Creates smooth negative space.

---

## Transform Nodes

Transform nodes manipulate UV coordinates for texture mapping, distortion, and coordinate space conversions.

### Basic Transforms

#### Transform 2D
Applies combined transformation to UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Transformed coordinates
- **Parameters**:
  - `Translate X` (float, default: 0.0) - Horizontal offset
  - `Translate Y` (float, default: 0.0) - Vertical offset
  - `Scale X` (float, default: 1.0) - Horizontal scale
  - `Scale Y` (float, default: 1.0) - Vertical scale
  - `Rotation` (float, default: 0.0) - Rotation angle in radians
  - `Center X` (float, default: 0.5) - Transform center X
  - `Center Y` (float, default: 0.5) - Transform center Y
- **Description**: Combines translation, rotation, and scaling transformations around a specified center point.

#### Scale 2D
Scales UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Scaled coordinates
- **Parameters**:
  - `Scale X` (float, default: 1.0) - Horizontal scale factor
  - `Scale Y` (float, default: 1.0) - Vertical scale factor
  - `Center X` (float, default: 0.5) - Scale center X
  - `Center Y` (float, default: 0.5) - Scale center Y
- **Description**: Scales UV coordinates around a center point. Values > 1 zoom in, values < 1 zoom out.

#### Rotate 2D
Rotates UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Rotated coordinates
- **Parameters**:
  - `Rotation` (float, default: 0.0) - Rotation angle in radians
  - `Center X` (float, default: 0.5) - Rotation center X
  - `Center Y` (float, default: 0.5) - Rotation center Y
- **Description**: Rotates UV coordinates around a center point. Use Pi node for convenient angle conversion.

#### Translate 2D
Translates (offsets) UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Translated coordinates
- **Parameters**:
  - `Translate X` (float, default: 0.0) - Horizontal offset
  - `Translate Y` (float, default: 0.0) - Vertical offset
- **Description**: Shifts UV coordinates by a fixed amount. Useful for panning textures and patterns.

#### Tile and Offset
Applies tiling and offset to UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Tiled and offset coordinates
- **Parameters**:
  - `Tiling X` (float, default: 1.0) - Horizontal repeat count
  - `Tiling Y` (float, default: 1.0) - Vertical repeat count
  - `Offset X` (float, default: 0.0) - Horizontal offset
  - `Offset Y` (float, default: 0.0) - Vertical offset
- **Description**: Classic UV tiling and offset operation. Tiling creates repeating patterns, offset shifts them.

#### Flip 2D
Flips UV coordinates horizontally and/or vertically.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Flipped coordinates
- **Parameters**:
  - `Flip X` (bool, default: false) - Flip horizontally
  - `Flip Y` (bool, default: false) - Flip vertically
- **Description**: Mirrors UV coordinates along horizontal and/or vertical axes.

### Coordinate Conversion

#### UV to Color
Converts UV coordinates to a color for visualization.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec3) - Color representation of UV
- **Description**: Visualizes UV coordinates as colors (U=Red, V=Green). Useful for debugging UV layouts.

#### Polar Coordinates
Converts Cartesian coordinates to polar coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input Cartesian coordinates
- **Outputs**:
  - `out` (vec2) - Polar coordinates (angle, radius)
- **Parameters**:
  - `Center X` (float, default: 0.5) - Polar center X
  - `Center Y` (float, default: 0.5) - Polar center Y
  - `Radial Scale` (float, default: 1.0) - Radius scaling
  - `Angular Scale` (float, default: 1.0) - Angle scaling
- **Description**: Converts to polar coordinate system. Creates radial patterns and circular warping effects.

### Distortion Effects

#### Spherize
Applies spherical distortion to UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Spherized coordinates
- **Parameters**:
  - `Center X` (float, default: 0.5) - Effect center X
  - `Center Y` (float, default: 0.5) - Effect center Y
  - `Strength` (float, default: 0.5) - Distortion strength
  - `Radius` (float, default: 0.5) - Effect radius
- **Description**: Creates a spherical bulge or pinch distortion effect.

#### Twirl
Applies twisting/swirling distortion to UV coordinates.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `out` (vec2) - Twirled coordinates
- **Parameters**:
  - `Center X` (float, default: 0.5) - Twirl center X
  - `Center Y` (float, default: 0.5) - Twirl center Y
  - `Strength` (float, default: 1.0) - Rotation intensity
  - `Radius` (float, default: 0.5) - Effect radius
- **Description**: Creates a spiral/vortex distortion effect, rotating UVs around a center point.

#### Kaleidoscope
Creates kaleidoscope mirror effects.

- **Category**: Transform
- **Inputs**:
  - `UV` - Input coordinates
- **Outputs**:
  - `UV` - Kaleidoscope coordinates
- **Parameters**:
  - `Segments` (int, default: 6, range: 1-24) - Number of mirror segments
  - `Angle` (float, default: 0.0) - Rotation offset
  - `Scale` (float, default: 1.0, range: 0.01-5.0) - Zoom level
- **Description**: Creates repeating mirror symmetry patterns like a kaleidoscope. Segments parameter controls the number of mirror repetitions.

---

## Appendix

### Data Types

The GLSL Node Editor uses the following data types for node connections:

- **f32**: Single floating-point value (scalar)
- **vec2**: 2D vector (x, y)
- **vec3**: 3D vector (x, y, z) - typically used for RGB colors
- **vec4**: 4D vector (x, y, z, w) - typically used for RGBA colors
- **dynamic**: Type adapts to match input connections

### Parameter Types

Nodes can have various parameter types:

- **float**: Floating-point number input
- **int**: Integer number input
- **bool/boolean**: True/false checkbox
- **select**: Dropdown menu with predefined options
- **file**: File upload (for textures)
- **expression**: Text input for mathematical expressions
- **colorstops**: Color gradient editor
- **slider**: Ranged value slider

### Tips for Using Nodes

1. **Type Matching**: Most mathematical operations work with both scalars and vectors. When mixing types, scalars are broadcast to match vector dimensions.

2. **UV Workflow**: Typical workflow starts with a UV node, applies transforms or generates patterns, then samples textures or creates procedural effects.

3. **Noise Layering**: Combine multiple noise nodes with different scales and amplitudes to create complex, natural-looking patterns.

4. **SDF Workflow**: Use Field nodes to generate basic shapes, then combine them with Blend nodes to create complex geometry through constructive solid geometry operations.

5. **Color Grading**: Use Utility nodes like Contrast, Brightness, and Saturate Color in sequence to achieve sophisticated color grading effects.

6. **Performance**: Nodes with many octaves (like FBM Noise) or complex calculations can impact performance. Start with lower values and increase as needed.

7. **Debugging**: Use the UV to Color node to visualize coordinate spaces and transformations.
