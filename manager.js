import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

let regPath = path.resolve('registry.json');

const entries = await fs.readdir(".", { withFileTypes: true }); // all files and directories of plugins dir

let update = [];
let added = [];

// Load existing registry or create new one
let registry;
if (fs.existsSync(regPath)) {
	try {
		registry = JSON.parse(fs.readFileSync(regPath, "utf-8"));
	} catch (err) {
		registry = {
			lastUpdated: new Date().toISOString(),
			plugins: {}
		};  
	}
} else {
	registry = {
		lastUpdated: new Date().toISOString(),
		plugins: {}
	};  
}


for (const entry of entries) {
	if (!entry.isDirectory()) continue; // if it is not a directory, skip and continue the next loop
	
	const manifestPath = path.join(".", entry.name, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) continue;
	
	try {
		const manifest = await fs.readJson(manifestPath); // manifest = data from manyplug.json
		const pluginName = manifest.name || entry.name;

		// Check if plugin exists in registry and version changed
		const existing = registry.plugins[pluginName]; // existing = plugin in registry.json
		if (!existing) {
			added.push({
				name: pluginName,
				version: manifest.version
			});
			registry.plugins[pluginName] = manifest;
		} else if (existing.version !== manifest.version) {
			const oldVersion = existing.version;
			existing.version = manifest.version;
			
			update.push({
				name: pluginName,
				oldVersion: oldVersion,
				newVersion: existing.version
			});
		}
	} catch (err) {
		console.warn(chalk.yellow(`⚠️  Failed to read ${entry.name}: ${err.message}`));
	}
}

// Update timestamp
registry.lastUpdated = new Date().toISOString();

await fs.writeJson(regPath, registry, { spaces: 2 });

console.log(chalk.green(`Registry synced\n`));
console.log(chalk.blue(` New plugins registred (${added.length}):`));
console.log(chalk.blue(added.map(a => `  + ${a.name} (${a.version})`).join('\n')));

console.log(chalk.yellow(` Plugins updated (${update.length}):`));
console.log(chalk.yellow(update.map(u => `  * ${u.name} (${u.oldVersion}) -> (${u.newVersion})`).join('\n')));
