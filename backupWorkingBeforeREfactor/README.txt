
Rhizomium Web — Save/Load Integration (Corrected Bundle)

Files:
• save_load.js                 → core save/load (versioned JSON, autosave, hotkeys, UI)
• index.save-load.example.html → working example wired up with a tiny demo editor
• test_editor_stub.js          → demo-only editor to verify save/load quickly
• adapter_example.js           → optional adapter if your editor uses different method names

How to integrate into your real project:
1) Copy save_load.js next to your scripts.
2) In your real index.html, after your real editor is created and assigned to `window.editor`, add:
   <script src="./save_load.js"></script>
   <script>
     window.addEventListener('DOMContentLoaded', () => {
       const sl = new RhizomiumSaveLoad.SaveLoad(window.editor, { key: 'rhizomium.autosave.v1' });
       sl.enableAutoSave({ key: 'rhizomium.autosave.v1', debounceMs: 500 });
       sl.attachHotkeys(window, { filename: 'rhizomium-project.json' });
       RhizomiumSaveLoad.mountSaveLoadUI(sl);
       sl.loadFromLocal('rhizomium.autosave.v1');
       window.saveLoad = sl;
     });
   </script>
3) If your editor API names differ, include adapter_example.js after you assign window.editor.

Quick test:
• Open index.save-load.example.html in a local server.
• Try Ctrl+S (download), Ctrl+O (import), Ctrl+Shift+S (save to local), Ctrl+L (load from local).

Notes:
• No framework required. No globals other than `window.editor` and `window.saveLoad`.
• If invalidate() isn't called on changes, call editor._saveLoad_markDirty() yourself.
