#version 300 es

precision highp float;


in vec2 v_position;         //already in the grid coordinate system
in vec2 v_velocity;

out vec4 outColor;

float kernel(vec2 pos) {
  vec2 absPos = abs(pos);
  float x = max(1.0 - absPos.x, 0.0);
  float y = max(1.0 - absPos.y, 0.0);
  return x*y;
}
 
void main() {
  //outColor = vec4(0.1,0.1,0.1,0.1);

  vec2 cellIdx = floor(gl_FragCoord.xy);

  vec2 xface = cellIdx + vec2(0.0, 0.5);
  vec2 yface = cellIdx + vec2(0.5, 0.0);
  
  float wx = kernel(v_position - xface);
  float wy = kernel(v_position - yface);

  //outColor = vec4(v_velocity.x, v_velocity.y, v_velocity.x, v_velocity.y);
  //outColor = vec4(v_position.x, v_position.y, v_position.x, v_position.y);
  //outColor = vec4(wx, wy, wx, wy);
  outColor = vec4(wx*v_velocity.x, wy*v_velocity.y, wx, wy);
}