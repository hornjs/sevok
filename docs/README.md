## Generate app configs:

```bash
pnpm run config
```

## Build your project for Cloudflare Pages:

```bash
npx nuxi build --preset=cloudflare_pages
```

## Create D1 database.

```bash
npx wrangler d1 create sevok-docs-db
```

## Deploy, it will ask you to create a project for the first time:

```bash
npx wrangler pages deploy dist/
```
