import { register } from 'node:module';

register(new URL('./resolve-three-hook.mjs', import.meta.url), {
  parentURL: import.meta.url,
});
