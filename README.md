# Bump Up

An arcade smash-and-grow driving game that runs in the browser. Drive through a neon night city, smash anything smaller than you, and grow from a sedan to an SUV, a truck and a bus.

Four maps, easiest first: **Salt Flats** (open desert, no roads), **Seaside Strip** (open plazas, car parks and a beach), **The Docks** (container yards and warehouses) and **Downtown** (tight grid of towers). Each can be played by day or night. One **Tank** bar does the work of fuel and health: it drains as you drive and bump into things, and refills when you smash.

**Play:** https://mesoyoung.github.io/bumpup/

## Controls

| | Keyboard | Phone (one finger) |
|---|---|---|
| Steer | ← → | Drag left / right |
| Boost | Shift or Space | Double-tap and hold |
| Hop | ↑ | Swipe up |
| Pause | P or Esc | Two fingers |

## Project layout

```
index.html        page and menus
css/style.css     HUD and menu styling
js/config.js      tuning: tiers, speeds, points, traffic mix, police, boost
js/progress.js    missions and garage upgrades
js/models.js      vehicle and prop models
js/maps.js        the four maps: layouts, colours, picker previews
js/world.js       builds the chosen map: roads, buildings, props, ramps, collisions
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
