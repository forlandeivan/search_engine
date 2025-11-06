const fs = require('fs');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Remove duplicates from dependencies
const deps = {};
const depKeys = Object.keys(packageJson.dependencies);
depKeys.forEach(key => {
  if (!deps[key]) {
    deps[key] = packageJson.dependencies[key];
  }
});
packageJson.dependencies = deps;

// Remove duplicates from devDependencies
const devDeps = {};
const devDepKeys = Object.keys(packageJson.devDependencies);
devDepKeys.forEach(key => {
  if (!devDeps[key]) {
    devDeps[key] = packageJson.devDependencies[key];
  }
});
packageJson.devDependencies = devDeps;

fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
console.log('✅ Fixed package.json - removed duplicates');
