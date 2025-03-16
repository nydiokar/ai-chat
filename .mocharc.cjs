module.exports = {
    extension: ['.ts'],
    'node-option': [
        'experimental-specifier-resolution=node'
    ],
    spec: ['src/**/*.test.ts'],
    watchFiles: ['src/**/*.ts'],
    timeout: 5000,
    exit: true,
    color: true,
    reporter: 'spec',
    ui: 'bdd',
    parallel: false,
    recursive: true
}; 