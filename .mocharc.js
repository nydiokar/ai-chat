export default {
    require: ['ts-node/register'],
    extension: ['.ts'],
    'node-option': [
        'experimental-specifier-resolution=node',
        'loader=ts-node/esm'
    ],
    spec: ['src/**/*.test.ts'],
    watchFiles: ['src/**/*.ts'],
    timeout: 5000,
    exit: true,
    color: true,
    reporter: 'spec',
    ui: 'bdd',
    parallel: false, // Disable parallel for now until ESM issues are resolved
    recursive: true
}; 