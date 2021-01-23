# FLIP-2d-sim-gpu

FLIP 2d simulation (on the GPU).

[Click on this link to play with it!](http://aaubel.online.fr/flip)
Works on most Android devices & PCs and should work on most Apple devices (you may need to enable WebGL2 in your Safari advanced settings though).

This is a small personal project coded over the holidays to play some more with WebGL. It is decently fast and fun to play with despite running only on one core by default. There's a UI switch to perform the pressure solve on the GPU using a fixed number of Jacobi iterations but it is (not surprisingly) about the same or even slower than the preconditioned conjugate gradient (PCG) running on the CPU. A port of the PCG to the GPU with a modified preconditioner is in the works...:-)
