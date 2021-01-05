#version 300 es

in vec2 a_position;
in vec2 a_velocity;
uniform float u_resolution;
uniform float u_particleRadius;

out vec3 v_color;


const vec3 speedRamp[] = vec3[] (
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 0.5, 1.0),
    vec3(1.0, 1.0, 1.0)
);

vec3 generateVertexColor() {
    
  // ramp color by speed of particle
  float speed = length(a_velocity)*0.25f - 0.5f;
  speed = clamp(speed, 0.0f, 1.999f);
  float segment = floor(speed);      
  float t = fract(speed);
  vec3 startVal = speedRamp[int(segment)];
  vec3 endVal = speedRamp[int(segment) + 1];
  return mix(startVal, endVal, t);    
}

// all shaders have a main function
void main() {
  
  v_color = generateVertexColor();
  gl_PointSize = u_particleRadius;

  // convert the position to [-1..1]
  vec2 pos = a_position / u_resolution;
  gl_Position = vec4(pos,0.0,1.0);  
}