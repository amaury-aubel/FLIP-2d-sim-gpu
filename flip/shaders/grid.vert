#version 300 es

precision highp float;

in vec2 a_position;
in vec3 a_color;
uniform float u_resolution;
uniform float u_cellSize;

out vec3 v_color;

// all shaders have a main function
void main() {  
  
  v_color = a_color;
  //v_color = vec3(1,0,1);
  gl_PointSize = u_cellSize;

  // convert the position to [-1..1]
  vec2 pos = a_position / u_resolution;
  gl_Position = vec4(pos,0.0,1.0);  
}