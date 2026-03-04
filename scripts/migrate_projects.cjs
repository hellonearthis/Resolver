const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function migrateProject(projectDir) {
    if (!fs.statSync(projectDir).isDirectory() || !path.basename(projectDir).startsWith('PRJ_')) {
        return;
    }

    console.log(`\nMigrating project: ${path.basename(projectDir)}`);

    const sourceDir = path.join(projectDir, 'source');
    const stemsDir = path.join(projectDir, 'stems');

    // Create folders
    if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
    if (!fs.existsSync(stemsDir)) fs.mkdirSync(stemsDir, { recursive: true });

    // Find the old data file
    const oldFiles = fs.readdirSync(projectDir);
    const dataFileName = oldFiles.find(f => f.endsWith('_data.json'));

    if (!dataFileName) {
        // Might already be migrated or invalid
        if (oldFiles.includes('project.json')) {
            console.log('  -> Already migrated.');
        } else {
            console.log('  -> No _data.json found, skipping.');
        }
        return;
    }

    const dataFile = path.join(projectDir, dataFileName);
    const projectData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

    // Move original audio if it's in the project folder
    if (projectData.audioPath) {
        const audioName = path.basename(projectData.audioPath);
        const originalLocalPath = path.join(projectDir, audioName);

        if (fs.existsSync(originalLocalPath)) {
            const newAudioPath = path.join(sourceDir, audioName);
            fs.renameSync(originalLocalPath, newAudioPath);
            projectData.audioPath = `./source/${audioName}`;
            console.log(`  -> Moved audio to source/${audioName}`);
        } else if (fs.existsSync(projectData.audioPath)) {
            // It's outside, let's copy it in.
            const newAudioPath = path.join(sourceDir, audioName);
            fs.copyFileSync(projectData.audioPath, newAudioPath);
            projectData.audioPath = `./source/${audioName}`;
            console.log(`  -> Copied external audio to source/${audioName}`);
        }
    }

    // Move stems and update paths
    if (projectData.stems && Array.isArray(projectData.stems)) {
        projectData.stems.forEach(stem => {
            if (stem.path) {
                const stemFileName = path.basename(stem.path);
                const oldStemPathLocal = path.join(projectDir, stemFileName);
                const newStemPath = path.join(stemsDir, stemFileName);

                if (fs.existsSync(oldStemPathLocal)) {
                    fs.renameSync(oldStemPathLocal, newStemPath);
                    stem.path = `./stems/${stemFileName}`;
                    console.log(`  -> Moved stem to stems/${stemFileName}`);
                } else if (fs.existsSync(stem.path)) {
                    fs.copyFileSync(stem.path, newStemPath);
                    stem.path = `./stems/${stemFileName}`;
                    console.log(`  -> Copied external stem to stems/${stemFileName}`);
                }
            }
        });
    }

    // Save as project.json
    const newProjectFile = path.join(projectDir, 'project.json');
    fs.writeFileSync(newProjectFile, JSON.stringify(projectData, null, 2));

    // Delete old data file
    fs.unlinkSync(dataFile);

    console.log(`  -> Saved project.json. Migration successful.`);
}

function runMigration() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        console.log(`Output directory not found at ${OUTPUT_DIR}`);
        return;
    }

    const items = fs.readdirSync(OUTPUT_DIR);
    items.forEach(item => {
        migrateProject(path.join(OUTPUT_DIR, item));
    });
}

runMigration();
