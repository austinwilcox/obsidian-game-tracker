# Game Tracker

Search for a game, add it as a note with its box art and details, track what you're playing, and log when you beat things. Built with retro games in mind.

## Install

1. In your vault, create the folder `.obsidian/plugins/game-tracker/`
2. Copy `main.js`, `manifest.json`, and `styles.css` into it
3. In Obsidian: Settings > Community plugins > turn off Restricted mode > reload > enable **Game Tracker**

That's all. Retro search needs no account and no API key.

## How retro search works

It borrows from how RetroArch identifies games:

- **Game lists and details** come from the [libretro database](https://github.com/libretro/libretro-database), the same data RetroArch uses. Cartridge systems use No-Intro names and disc systems use Redump names. Entries carry developer, genre, release year, and franchise where known. For PlayStation, PlayStation 2, and Dreamcast, many entries also carry a description and publisher.
- **Box art** comes from the [libretro thumbnails](https://github.com/libretro-thumbnails/libretro-thumbnails), looked up by the exact game name. If a game has no box art, the plugin falls back to its title screen, then an in-game screenshot.
- **Descriptions** for systems where libretro has none are looked up on Wikipedia, only when the page clearly matches the game. You can turn this off in settings.

The first search for each system downloads that system's list once (about 0.5 MB for SNES, a few MB for PlayStation) and saves it in the plugin's `cache` folder. After that, search is instant and works offline. The list refreshes itself every 90 days.

## Add a game

Click **Add game** on the dashboard, or run **Game Tracker: Add game (search)**. Pick the system, type a title, and choose a result. Regional releases are grouped, and the plugin prefers the USA or World version.

You get a form with the platform, genres, and details filled in. Set your status and add it. The note gets:

- the box art, saved to `Games/_covers/`
- a short About section when a description is found
- properties for genre, release year, developer, publisher, region, and franchise

If the same title exists on two systems (Sonic on Genesis and Game Gear), the second note is named with the platform, like `Sonic The Hedgehog (Game Gear)`.

For games not covered by retro search, switch the source to **Modern games (RAWG)** in the search window. That needs a free key from rawg.io/apidocs, set in the plugin settings.

## Status folders

Game notes are kept in a subfolder for their status:

```
Games/
  Playing/
  Backlog/
  On hold/
  Beaten/
  Completed/
  Dropped/
  _covers/
```

When a game's status changes (from the dashboard, the edit form, a command, or by editing the `status` property yourself), the note moves to the matching folder. Links to it are updated. Notes already in the Games folder are sorted when Obsidian starts, or run **Sort games into status folders**. Turn this off in settings with **Status folders**; notes then stay where they are.

## Existing notes

Move a note into the Games folder, then use the card's ⋮ menu > **Fetch game info**, or run **Fetch game info for current note**. If the note's platform property matches a known system, that system is preselected. Your status, dates, and rating are never changed.

## Supported systems

Atari 2600, 5200, 7800, Jaguar, Lynx, ST. WonderSwan and WonderSwan Color. ColecoVision, Commodore 64, Vectrex, Odyssey 2, Intellivision, MSX, MSX2. TurboGrafx-16, SuperGrafx, TurboGrafx-CD. NES, Famicom Disk System, SNES, Game Boy, Game Boy Color, Game Boy Advance, Nintendo 64, Nintendo DS, Virtual Boy, Pokemon Mini. SG-1000, Master System, Genesis, 32X, Sega CD, Saturn, Dreamcast, Game Gear. Neo Geo Pocket, Neo Geo Pocket Color, Neo Geo CD. PlayStation, PlayStation 2, PSP. 3DO, CD-i.

Arcade (MAME/FinalBurn) and GameCube/Wii are not included yet.

## Coverage notes

Details depend on the system. Cartridge systems like SNES, Genesis, and Game Boy have developer, genre, and year for most games. Some disc systems (Saturn, 3DO, CD-i, Neo Geo CD, TurboGrafx-CD) have names and box art but little or no other data, and you can fill the rest in by hand.

## The dashboard

- **Library**: cards with box art, grouped into Playing, Backlog, On hold, Beaten, 100% completed, and Dropped.
- **Beaten log**: finished games by year with a monthly chart, hours, average rating, and days to beat.
- **Beat it** asks for the date, rating, and hours; the date defaults to today.

Commands (Ctrl/Cmd+P): Add game (search), Open dashboard, Fetch game info for current note, Mark current note as playing, Mark current note as beaten, Edit current game details, Sort games into status folders.

## Stored properties

```yaml
---
type: game
status: beaten        # backlog, playing, paused, beaten, completed, dropped
platform: SNES
genre: [Role-playing (RPG)]
started: 2026-09-28
finished: 2026-10-21
rating: 10
hours: 28
cover: Games/_covers/snes-chrono-trigger.png
released: 1995
developer: [Square]
region: USA
libretro_name: Chrono Trigger (USA)
---
```

All plain properties, so Dataview and Bases can use them too. If you add a RAWG key, it is stored in the plugin's `data.json`; don't commit or publish that file.
