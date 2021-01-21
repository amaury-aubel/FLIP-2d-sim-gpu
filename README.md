# FLIP-2d-sim-gpu

FLIP 2d simulation (on the GPU).

[Click on this link to play with it!](http://aaubel.online.fr/flip)
Works on most Android devices & PCs and should work on most Apple devices (you may need to enable WebGL2 in your Safari settings though).

This is a small personal project coded over the holidays to play some more with WebGL. Note that the current version (linked above) does not run yet on the GPU. However, it is decently fast and fun to play with despite running only on one core.

I have a working version of the pressure solve on the GPU using a fixed number of Jacobi iterations but it is (not surprisingly) slower than the preconditioned conjugate gradient (PCG) on the CPU. A port of the PCG with a modified preconditioner is in the works...:-)
