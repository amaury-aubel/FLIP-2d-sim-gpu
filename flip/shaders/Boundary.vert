#version 300 es

// an attribute is an input (in) to a vertex shader.
// It will receive data from a buffer
in vec2 position;

// Used to pass in the resolution of the canvas
uniform float resolution;

// all shaders have a main function
void main() {

  // convert the position to [-1..1]
  vec2 pos = position / resolution;
  gl_Position = vec4(pos, 0, 1);
}