# Save & Load System

Learn how to save, load, and manage your Rhizomium projects.

---

## Overview

Rhizomium includes a comprehensive project management system that allows you to:

- Save your node graphs as project files
- Load previously saved projects
- Auto-save functionality
- Export/import projects as JSON files
- Manage multiple projects

---

## Saving Projects

### Quick Save

**Keyboard Shortcut**: `Ctrl+S` (Windows/Linux) or `Cmd+S` (Mac)

**Menu**: **File → Save**

### What Gets Saved

When you save a project, Rhizomium stores:

- **Node Graph**: All nodes, their positions, and connections
- **Parameters**: All node parameter values
- **Project Metadata**: Name, timestamp, version
- **UI State**: Canvas position and zoom level (optional)

### Save Location

**Local Installation:**
- Projects are saved to the `saves/` folder in the project directory
- Each project is a `.json` file

**Web Version:**
- Projects are saved to your browser's Local Storage
- Limited by browser storage quota (usually 5-10MB)

---

## Loading Projects

### Load Menu

1. Choose **File → Open Project…**
2. Browse your saved projects
3. Click a project name to load it

### What Happens When Loading

1. Current graph is cleared (you'll be prompted to save if there are unsaved changes)
2. Saved node graph is restored
3. All parameters are restored
4. Canvas view is reset (or restored if saved)

---

## Project File Format

Rhizomium uses JSON format for project files, making them human-readable and easy to version control.

### Example Structure

```json
{
  "version": "1.0",
  "name": "My Visual",
  "timestamp": "2024-11-05T10:30:00Z",
  "nodes": [
    {
      "id": "1",
      "kind": "UV",
      "x": 100,
      "y": 200,
      "params": {}
    },
    {
      "id": "2",
      "kind": "Circle",
      "x": 300,
      "y": 200,
      "params": {
        "radius": 0.5
      }
    }
  ],
  "connections": [
    {
      "from": "1",
      "fromPin": 0,
      "to": "2",
      "toPin": 0
    }
  ]
}
```

---

## Auto-Save

Rhizomium can automatically save your work at regular intervals.

### Enabling Auto-Save

1. Open **Settings** (gear icon)
2. Enable **Auto-Save**
3. Set interval (e.g., every 5 minutes)

### Auto-Save Behavior

- Creates a special auto-save file
- Does not overwrite your main project file
- Recovers automatically if the browser crashes

---

## Exporting Projects

### Export as JSON

1. Click **Export** button or **File → Export**
2. Choose a location on your computer
3. Save the `.json` file

### Why Export?

- **Backup**: Keep copies of important projects
- **Sharing**: Send projects to others
- **Version Control**: Use with Git for collaboration
- **Migration**: Move projects between installations

---

## Importing Projects

### Import from JSON

1. Click **Import** button or **File → Import**
2. Select a `.json` file from your computer
3. The project loads immediately

### Importing from Web Version

If you saved a project on the web version:

1. Open browser console (F12)
2. Navigate to **Application → Local Storage**
3. Find your project data
4. Copy the JSON
5. Create a new `.json` file on your local installation
6. Import the file

---

## Project Management

### Organizing Projects

**Local Installation:**
- Create subfolders in `saves/` to organize by category
- Use descriptive filenames: `colorful_circles_v2.json`

**Web Version:**
- Name projects clearly in the save dialog
- Export important projects as backup

### Deleting Projects

**Local Installation:**
- Delete `.json` files from the `saves/` folder

**Web Version:**
- Use the Load menu's delete button
- Or clear browser data (deletes ALL projects!)

---

## Backup Strategies

### For Local Installation

1. **Regular Exports**: Export important projects to a backup folder
2. **Version Control**: Use Git to track changes
3. **Cloud Sync**: Save the `saves/` folder to Dropbox/Google Drive

### For Web Version

1. **Regular Exports**: Download JSON files frequently
2. **Don't Clear Browser Data**: This deletes all projects!
3. **Use Multiple Browsers**: Spread projects across Chrome, Edge, etc. as backup

---

## Sharing Projects

### Sharing with Others

1. Export your project as JSON
2. Share the `.json` file (email, GitHub, etc.)
3. Recipient imports it into their Rhizomium installation

### Collaboration Tips

- Use descriptive project names
- Add comments (node names) to explain complex sections
- Keep graphs organized and clean
- Test on a fresh installation before sharing

---

## Project Migration

### Moving from Web to Local

1. Open your project on the web version
2. **Export** the project as JSON
3. Download the file
4. On local installation, **Import** the JSON file

### Moving from Local to Web

1. Open your project in local installation
2. **Export** the project as JSON
3. Open web version
4. **Import** the JSON file

**Note**: External Viewer features won't work on web version.

---

## Troubleshooting

### "Failed to save project"

**Local Installation:**
- Check write permissions for `saves/` folder
- Ensure disk space is available
- Check that the folder exists

**Web Version:**
- Browser storage quota exceeded
- Solution: Delete old projects or export and clear storage

### "Failed to load project"

**Possible causes:**
1. Corrupted JSON file - Check file syntax
2. Incompatible version - Update Rhizomium
3. File not found - Check file location
4. Browser storage issue - Clear cache and retry

### "Unsaved changes" warning doesn't appear

- Auto-save might be overwriting your project
- Disable auto-save if you want manual control

### Projects disappeared (Web Version)

**Causes:**
- Browser data was cleared
- Incognito/Private mode was used
- Different browser profile

**Prevention:**
- Regular exports as backup
- Don't rely solely on browser storage

---

## Best Practices

### 1. Save Early, Save Often

Don't wait until your graph is complete. Save after each significant addition.

### 2. Use Version Numbers

Name projects with versions: `my_visual_v1.json`, `my_visual_v2.json`

### 3. Export Before Major Changes

Before making big modifications, export a backup.

### 4. Descriptive Names

Use clear names: `audio_reactive_circles.json` not `project1.json`

### 5. Keep a Backup

Always maintain at least one backup copy of important projects.

### 6. Test Loading

Periodically test that your saved projects load correctly.

---

## File Structure (Local Installation)

```
rhizomium/
├── saves/
│   ├── my_project.json
│   ├── audio_visual.json
│   ├── performance/
│   │   ├── show_1.json
│   │   └── show_2.json
│   └── experiments/
│       └── test_pattern.json
```

---

## Version Control with Git

### Setting Up

```bash
# Initialize git in saves folder
cd saves/
git init
git add *.json
git commit -m "Initial projects"
```

### Benefits

- Track changes over time
- Revert to previous versions
- Collaborate with others
- Keep a complete history

### .gitignore Example

```
# Don't track auto-saves
*_autosave.json

# Don't track temporary files
*.tmp
```

---

## Advanced: Programmatic Access

For developers, project files can be manipulated programmatically:

```javascript
// Load project
const project = JSON.parse(fs.readFileSync('my_project.json'));

// Modify
project.nodes[0].params.value = 2.0;

// Save
fs.writeFileSync('my_project_modified.json', JSON.stringify(project, null, 2));
```

---

## Next Steps

- **[Your First Graph](guide.md)** - Create something to save!
- **[Deployment](deployment.md)** - Learn about deployment considerations
- **[Troubleshooting](troubleshooting.md)** - Fix save/load issues

---

_Never lose your work - save regularly and keep backups!_
