# Hosting & Deployment

MQTT Topic Visualiser is a purely client-side static SPA — there is no backend server. The build output (`dist/`) is just HTML, CSS, and JavaScript. Deploy it to any static hosting provider: GitHub Pages, Netlify, S3, a simple nginx server, or even a local file server.

All MQTT connections happen directly between the user's browser and whatever broker they configure. Your hosting infrastructure never sees MQTT traffic.

## Building for Production

```bash
npm run build
npm run preview    # preview the production build locally
```

The output in `dist/` is ready to deploy. To customise defaults for a specific deployment (broker URL, autoconnect, panel state, etc.), edit `dist/config.json` after building — no rebuild required. See [configuration.md](configuration.md) for full details.

## Mixed Content

Most static hosting providers (GitHub Pages, Netlify, Vercel) serve over HTTPS. Browsers enforce mixed-content restrictions, which means pages loaded over `https://` cannot open plain `ws://` WebSocket connections. Users on HTTPS-hosted deployments will only be able to connect to `wss://` (TLS-secured) brokers.

This is a browser security restriction, not an application limitation. If your broker supports `wss://`, use that URL directly.

## Reverse Proxy for Plain WebSocket Brokers

If you serve this app over HTTPS but your MQTT broker only supports plain WebSocket (`ws://`), you need a reverse proxy to bridge the gap. The proxy terminates the `wss://` connection from the browser and forwards it to the broker's `ws://` endpoint.

Example nginx configuration:

```nginx
location /mqtt_ws/ {
    proxy_pass http://your-broker-host:9001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

Then set `brokerUrl` in `config.json` to `wss://your-https-host/mqtt_ws/`. The browser connects via `wss://` to nginx, which upgrades the connection and proxies to the broker over plain `ws://`.

## Customising a Deployment

Edit `config.json` in the deployed `dist/` directory to tailor the app for your environment:

- **Set a default broker** — pre-fill the connection form so users don't need to type a URL
- **Enable autoconnect** — connect to the broker automatically on page load
- **Collapse panels** — start with the connection and/or settings panels collapsed for a cleaner initial view
- **Lock the client ID** — set `clientId` to a fixed string for deployments that require a specific MQTT identity
- **Customise the broker dropdown** — list your internal brokers in the Quick Connect menu

See [configuration.md](configuration.md) for the full list of options and examples.
