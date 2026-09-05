# Host the operator UI on a free domain

The UI is static files in `packages/web/public`. It does not include the API.
A public host can serve the page; Connect must point at a **public** API URL
(`packages/api` with `CORS_ORIGIN=*` or the UI origin).

`127.0.0.1:3100` only works on your Mac. A `*.web.app` page cannot reach it.

## Firebase Hosting (`something.web.app`) — free

```bash
cd /Users/joyelgeorge/Documents/anti-grav/taskmen
git pull
npm install -g firebase-tools
firebase login
firebase projects:create taskman-operator --display-name "Taskman operator"
# or: firebase use --add   and pick an existing project
firebase deploy --only hosting
```

Firebase prints `https://<project-id>.web.app`.

On that page, Connect box = your public API, e.g.
`https://<your-api>.onrender.com`
not `http://127.0.0.1:3100`.

## Vercel (already configured)

`packages/web/vercel.json` serves `public/`.
Import the GitHub repo at vercel.com → set Root Directory to `packages/web`.
You get `https://<name>.vercel.app`.

## API CORS

`packages/api` defaults `CORS_ORIGIN=*`. For production set
`CORS_ORIGIN=https://<project-id>.web.app`.
