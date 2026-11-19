# MEETA Robot Viewer

An interactive HTML, CSS, and JavaScript viewer for the three MAKE Labs GLB exports. The project uses Three.js for rendering and Vite for development. Each tab loads its own GLB when selected.

## Upload directly to an existing website

1. Open the included `dist` folder. This contains the finished website.
2. Copy your three original GLBs into `dist/models/` using the exact filenames below.
3. Upload the **contents** of `dist/` into a directory on your website, such as `/meeta/`.
4. Open `https://your-domain.com/meeta/`.

| Tab | Filename |
| --- | --- |
| Plate | `MEETA_plate.glb` |
| Tablet | `MEETA_tablet.glb` |
| Triangle body | `MEETA_Body-Triangle-part-updated.glb` |

The uploaded directory should contain `index.html`, `assets/`, `models/`, and `licenses/`. Serve it over HTTP or HTTPS. All scripts, fonts, and materials are served from that directory.

### Embed the viewer in an existing page

After uploading the built files into `/meeta/`, paste this HTML where the viewer should appear.

```html
<iframe
  src="/meeta/"
  title="MEETA interactive robot viewer"
  loading="lazy"
  allowfullscreen
  style="display:block;width:100%;height:clamp(740px,88vh,960px);border:0"
></iframe>
```

## Edit the source or deploy through a Vite host

1. Place the GLBs in `public/models/` before building. Vite copies them to `dist/models/`.
2. From the project folder, run the following commands. Open the local URL printed in your terminal.

```sh
npm ci
npm run dev
```

To build and preview the production version locally, run these commands.

```sh
npm run build
npm run preview
```

| Hosting setting | Value |
| --- | --- |
| Project root | Folder containing `package.json` |
| Frontend preset | Vite |
| Node.js | 22.x or 24.x recommended. The pinned Vite version also accepts 20.x and 18.x. |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Hosting type | Static web hosting |

A new build regenerates `dist/` from the source and `public/`. Keep the GLBs in `public/models/` while developing.

## Controls

- **Mouse** — hover over the head, torso, base, either arm, a gripper, or a visible accessory. Move across that part to change its pose. Move off the robot to return it to rest.
- **Camera** — drag to orbit, scroll to zoom, or use the zoom and reset buttons.
- **Touch** — tap a part to pose it. Tap an empty area to release it. Drag with one finger to orbit or pinch with two fingers to zoom.
- **Keyboard** — use Left and Right on the tab strip to change configuration. Focus the 3D canvas and use the arrow keys to orbit, plus and minus to zoom, or R to reset.

## Customize the viewer

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, tab labels, controls, and accessible names |
| `src/styles.css` | Black background, orange interface accents, typography, and responsive layout |
| `src/robot.js` | Filenames, mesh selection, orange and black materials, mechanical pivots, and part movement |
| `src/stage.js` | Lighting, camera, floor, pointer picking, and orbit controls |
| `src/main.js` | Tab selection, GLB loading, error handling, and fullscreen |

The exports share a body and contain separate CAD meshes with different arm and accessory placements. The viewer builds a small joint hierarchy in memory. On the Plate tab both forearms lift together. On the Tablet and Triangle body tabs each arm can move independently. The Tablet tab also lets you tilt the holder.

The display uses the assembled meshes and skips overlapping backups, construction cutters, and parked accessories. It reflects the single-sided ear, eye, neck, and lower-body pieces across their symmetry axes. Set `MIRROR_CAD_HALVES` in `src/robot.js` to `false` to display those pieces as exported. Edit `FINISHES` in that file to change the robot's colors. All presentation changes happen in the browser.

If a tab shows a load error, open the indicated `models/<filename>.glb` URL on the same site. It should return the binary file. Check the filename case and the folder next to the published `index.html`, then press **Try again**.
