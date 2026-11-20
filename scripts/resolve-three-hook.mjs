// Lets Node scripts import the vendored Three build the browser resolves
// through the index.html import map.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return {
      url: new URL('../vendor/three.module.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
