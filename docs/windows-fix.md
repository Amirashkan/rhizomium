# Windows Fix - Editor Not Loading

The editor uses a symbolic link `editor/src -> ../src` which doesn't work on Windows by default.

## Quick Fix (Easiest)

Run Git Bash **as Administrator** and do this:

```bash
cd rhizomium

# Remove broken symlink
rm -f editor/src

# Create Windows junction (works like symlink)
cmd //c "mklink /J editor\\src src"
```

Now start the server and it should work:

```bash
python -m http.server 8080
```

Open: `http://localhost:8080/editor/index.html`

---

## Alternative: Access from Root

Instead of accessing `/editor/index.html`, create a redirect:

1. Open `index.html` in the project root
2. Change the content to redirect to editor

OR just manually navigate to the full path structure.

---

## Check if Symlink Works

```bash
ls -la editor/src
```

Should show:
```
lrwxrwxrwx 1 ... editor/src -> ../src
```

And this should work:
```bash
ls editor/src/ui/
```

Should list files (not error).

---

##If Nothing Works - Manual Copy

As a last resort, copy the files:

```bash
cd rhizomium

# Remove symlink
rm -f editor/src

# Copy src folder into editor
cp -r src editor/src
```

**Note:** With this approach, you'll need to re-copy whenever `src/` files change.

---

## Test It Works

After fixing the symlink:

1. Start server: `python -m http.server 8080`
2. Open: `http://localhost:8080/editor/index.html`
3. Press F12 → Console
4. Should see NO red 404 errors
5. Right-click on canvas → Node menu appears

If you still see 404 errors for files in `src/`, the symlink isn't working.
