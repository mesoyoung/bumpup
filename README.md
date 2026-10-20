# Bump Up

An arcade smash-and-grow driving game that runs in the browser. Drive through a neon night city, smash anything smaller than you, and grow from a sedan to an SUV, a truck and a bus.

**Play:** https://mesoyoung.github.io/bumpup/

## Controls

| | Keyboard | Phone (one finger) |
|---|---|---|
| Steer | ← → | Drag left / right |
| Boost | Shift or Space | Double-tap and hold |
| Brake / reverse | ↓ (hold at a stop to reverse) | Swipe down and hold |
| Hop | ↑ | Swipe up |
| Pause | P or Esc | Two fingers |

## Project layout

```
index.html        page and menus
css/style.css     HUD and menu styling
js/config.js      tuning: tiers, speeds, points, traffic mix, police, boost
js/progress.js    missions and garage upgrades
js/models.js      vehicle and prop models
js/world.js       city, props, ramps, collisions
js/actors.js      pedestrians, traffic, police, particles
js/player.js      driving physics and controls
js/ui.js          HUD, menus, game-over screen
js/game.js        main loop, scoring, smashing, camera
js/audio.js       sound effects and music
sounds/           engine and tyre recordings (cut and looped)
```

Built with [three.js](https://threejs.org/) r128, loaded from cdnjs. No build step: open `index.html` through any static web server.

## Credits

Engine and tyre recordings by freesound_community and olenchic, via [Pixabay](https://pixabay.com/). Music and all other sound effects are generated in code.
