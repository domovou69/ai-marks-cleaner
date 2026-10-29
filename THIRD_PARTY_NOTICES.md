# Third-party notices

| Component | Where | License | Copyright |
| --- | --- | --- | --- |
| [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) (cleaning engine) | `upstream/` (git submodule); copied `.py` files in the built site | MIT, full text in `upstream/LICENSE` and next to the copied files | Copyright (c) Guillaume Meyer |
| [Pyodide](https://pyodide.org) (Python runtime) | `pyodide/` in the built site (`pyodide.asm.*`, `python_stdlib.zip`, `pyodide-lock.json`) | MPL-2.0, text in `licenses/pyodide-LICENSE`; includes CPython (PSF License) | Copyright (c) Pyodide contributors |
| [Vite](https://vite.dev), [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) with [Workbox](https://developer.chrome.com/docs/workbox) (service worker) | bundled JS in the built site (`sw.js`, `workbox-*.js`) | MIT | Copyright (c) their authors |

The MIT license of each component requires its copyright notice and permission notice to be kept with every copy.
The build copies `upstream/LICENSE` next to the engine files (`engine/LICENSE`) and this file and the Pyodide license
into `licenses/` in the deployed site. Development tools that are not shipped (TypeScript, Playwright) are not listed.
