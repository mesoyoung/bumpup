# Bump Up

An arcade smash-and-grow driving game that runs in the browser, on phone or desktop. Smash anything smaller than you and grow from a sedan to an SUV, a truck and a bus.

**Play:** https://mesoyoung.github.io/bumpup/

## How it plays

- **Rings show what you can hit.** Green: smash it. Amber: it bounces you, unless you boost through it. Red: it wrecks you. Things too small to refuel you have no ring.
- **One Tank bar** does the work of fuel and health. It drains as you drive and when you bump into things, and refills when you smash. Food trucks top it up.
- **Boost** for double points and a fuller refill. Boosting at speed turns on **Power Ram**, which smashes through amber objects.
- **Combos, gold targets and police.** Chain smashes for a multiplier, hunt gold cars and people for 5x points, and the police escalate as you cause trouble.
- **Four maps**, easiest first: **Salt Flats** (open desert, no roads), **Seaside Strip** (plazas, car parks and a beach), **The Docks** (container yards) and **Downtown** (a tight grid of towers). Each can be played by day or night, and harder maps pay more coins (x0.5, x0.75, x1, x1.5).
- **Between runs:** missions that level you up, garage upgrades (tank, armour, nitro, combo timer) and 14 paint designs.
- **First-run tutorial** teaches steering. Replay it from How to play.

## Controls

| | Phone | Keyboard |
|---|---|---|
| Steer | Hold the left or right side of the screen; hold longer to turn harder | ← → |
| Boost | Tap the Boost button for a burst, or hold it | Shift or Space |
| Pause | II button | P or Esc |

**Steering** has three settings on the landing screen:
- **Simple** (default): hold left or right; no slides.
- **Drag**: drag from where you touch; no slides.
- **Drift**: drag; hard turns at speed slide, and a long slide gives a speed burst.

Sound and day/night toggle from the icons at the top right of the landing screen.

## Project layout

```
index.html        page, HUD, menus and tutorial
css/style.css     HUD and menu styling
js/config.js      tuning: tiers, speeds, points, traffic mix, police, boost, settings
js/progress.js    missions and garage upgrades
js/models.js      vehicle and prop models, threat rings, paint designs
js/maps.js        the four maps: layouts, colours, coin multipliers, picker previews
js/world.js       builds the chosen map: roads, buildings, props, ramps, collisions
js/actors.js      pedestrians, traffic, police, food trucks, debris, particles
js/player.js      driving physics and touch / keyboard controls
js/ui.js          HUD, score pop-ups, menus, game-over screen
js/game.js        main loop, scoring, smashing, tutorial, coaching tips, camera
js/audio.js       sound effects and music
sounds/           engine and tyre recordings (cut and looped)
```

Built with [three.js](https://threejs.org/) r128, loaded from cdnjs. No build step: open `index.html` through any static web server. Progress (coins, missions, upgrades, settings) is saved in the browser.

## Credits

Built by mesoyoung in collaboration with Claude (Anthropic). Engine and tyre recordings by freesound_community and olenchic, via [Pixabay](https://pixabay.com/). Music and all other sound effects are generated in code.
