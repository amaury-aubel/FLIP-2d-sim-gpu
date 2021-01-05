#version 300 es
precision highp float;

in vec2 a_position;


uniform float u_resolution;
uniform float u_orient;
uniform vec2 u_center;
uniform vec3 u_color;

out vec3 v_color;

// all shaders have a main function
void main() {  
  
  v_color = u_color;

  vec2 pos = a_position;

  // rotate by orient radians
  float s = sin(u_orient);
  float c = cos(u_orient);
  vec2 rot_pos = vec2(c * pos[0] - s * pos[1], s * pos[0] + c * pos[1]);
  
  // convert the position to [-1..1]
  pos = (rot_pos + u_center) / u_resolution;

  gl_Position = vec4(pos, 0, 1);
}
