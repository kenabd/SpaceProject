# Solar Drift Explorer (Cinematic Build)

High-fidelity solar-system explorer using Three.js with:

- Physically-inspired orbital motion and axial tilt
- Textured Sun, planets, Moon, and planetary rings
- Atmospheric glow shells for selected planets
- HDR environment lighting + bloom post-processing
- High-fidelity GLTF spacecraft (`PrimaryIonDrive`) with fallback ship
- Free-flight ship controls and planet jump shortcuts (`1`-`8`)

## Run

You can open `index.html` directly, but running over HTTP is more reliable for browser security and caching behavior:

```powershell
npx serve .
```

Then open the URL printed in terminal (usually `http://localhost:3000`).

## Controls

- `W` / `S`: forward / brake
- `A` / `D`: strafe left / right
- `R` / `F`: move up / down
- `Mouse` (pointer lock or drag): primary look control
- `Arrow Keys`: backup look control
- `Q` / `E`: roll
- `Shift`: boost
- `Visit Planet` panel: switch into astronaut walk mode
- `Return To Orbit`: return to solar-system flight
