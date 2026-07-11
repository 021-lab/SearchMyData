const buildHash = process.env.PREVIEW_BUILD_HASH || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

process.stdout.write(`${buildHash}\n`);
