# RiverNexa web app (source)

The site in `../docs` is built from this folder. Data stays in `../docs/data` and is never copied or changed by the build.

```
cd web
npm install
npm run dev     # local preview; reads data from the repo's main branch on GitHub
npm run build   # writes ../docs/index.html and ../docs/assets/
```

Before a rebuild, delete `../docs/assets/` so old hashed files do not pile up.

Design first drafted with Lovable from a written brief, then reviewed and adapted here.
