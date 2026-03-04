const path = require('path');

function testSaveLogic(currentOutputDir, projectName) {
    const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const folderName = `PRJ_${safeName}`;

    // Normalize path to prevent trailing slashes from breaking basename (recursive nesting fix)
    const normalizedOutputDir = currentOutputDir.replace(/[\\/]+$/, '');
    const dirBasename = path.basename(normalizedOutputDir);

    // Determine if outputDir already IS the per-project folder
    // Use startsWith('PRJ_') to prevent infinite nesting if the project name gets slightly altered
    const projectFolder = (dirBasename.startsWith('PRJ_') || dirBasename === safeName)
        ? normalizedOutputDir
        : path.join(normalizedOutputDir, folderName);

    console.log({
        projectName,
        currentOutputDir,
        normalizedOutputDir,
        dirBasename,
        projectFolder
    });
}

testSaveLogic("C:\\Users\\Desktop-Dev\\Desktop\\resolver\\output", "My Project");
testSaveLogic("C:\\Users\\Desktop-Dev\\Desktop\\resolver\\output\\PRJ_My_Project", "My Project");
testSaveLogic("C:\\Users\\Desktop-Dev\\Desktop\\resolver\\output\\PRJ_My_Project", "My Project Renamed");
testSaveLogic("C:\\Users\\Desktop-Dev\\Desktop\\resolver\\output\\", "Trailing Slash");
testSaveLogic("C:\\Users\\Desktop-Dev\\Desktop\\resolver\\output\\PRJ_Trailing_Slash\\", "Trailing Slash");
