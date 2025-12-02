# TenderWorld API Integration Documentation

This document outlines the API endpoints and changes required in the TenderWorld project to support the File Manager feature in the GLSL Node Editor.

## Overview

The File Manager feature allows users to:
- Browse their cloud-stored files in TenderWorld
- Upload new files
- Download and open files
- Create folders
- Delete files and folders
- View file metadata (size, modification date, etc.)

All operations require user authentication via cookies/session.

---

## Required API Endpoints

### 1. Authentication Check

**Endpoint:** `GET /api/auth/check`

**Description:** Check if the current user is authenticated.

**Request:**
```http
GET https://art.tenderworld.org/api/auth/check
Cookie: session_id=xxx (or your auth cookie)
```

**Response (Authenticated):**
```json
{
  "authenticated": true,
  "user": {
    "id": "user123",
    "email": "user@example.com",
    "username": "username"
  }
}
```

**Response (Not Authenticated):**
```json
{
  "authenticated": false
}
```

**Status Codes:**
- `200 OK` - Request successful
- `401 Unauthorized` - Not authenticated

**Implementation Notes:**
- Use existing authentication middleware/session management
- Return user info if authenticated
- Ensure CORS allows credentials: `Access-Control-Allow-Credentials: true`

---

### 2. List Files

**Endpoint:** `GET /api/files/list`

**Description:** Retrieve a list of files and folders in a given path for the authenticated user.

**Query Parameters:**
- `path` (string, optional): The directory path to list. Defaults to `/` (root).

**Request:**
```http
GET https://art.tenderworld.org/api/files/list?path=/my-projects
Cookie: session_id=xxx
```

**Response:**
```json
{
  "files": [
    {
      "name": "project1.json",
      "path": "/my-projects/project1.json",
      "type": "file",
      "size": 1024,
      "modified": "2024-01-15T10:30:00Z",
      "mimeType": "application/json"
    },
    {
      "name": "subfolder",
      "path": "/my-projects/subfolder",
      "type": "folder",
      "modified": "2024-01-14T15:20:00Z"
    },
    {
      "name": "shader.rz",
      "path": "/my-projects/shader.rz",
      "type": "file",
      "size": 2048,
      "modified": "2024-01-13T09:15:00Z",
      "mimeType": "application/json"
    }
  ],
  "path": "/my-projects",
  "parentPath": "/"
}
```

**Response Fields:**
- `files` (array): List of files and folders
  - `name` (string): File/folder name
  - `path` (string): Full path
  - `type` (string): Either `"file"` or `"folder"`
  - `size` (number, optional): File size in bytes (only for files)
  - `modified` (string, ISO 8601): Last modification timestamp
  - `mimeType` (string, optional): MIME type (only for files)

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User doesn't have access to this path
- `404 Not Found` - Path doesn't exist

**Implementation Notes:**
- Ensure users can only access their own files
- Validate path to prevent directory traversal attacks
- Sort files: folders first, then files (alphabetically)
- Include pagination if needed for large directories

---

### 3. Download File

**Endpoint:** `GET /api/files/download`

**Description:** Download a file's content.

**Query Parameters:**
- `path` (string, required): The full path to the file.

**Request:**
```http
GET https://art.tenderworld.org/api/files/download?path=/my-projects/project1.json
Cookie: session_id=xxx
```

**Response (JSON file):**
```json
{
  "content": {
    "nodes": [...],
    "connections": [...]
  },
  "filename": "project1.json",
  "mimeType": "application/json"
}
```

**Response (for binary files - return as binary with appropriate headers):**
```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="file.rz"
```

**Status Codes:**
- `200 OK` - File downloaded successfully
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User doesn't have access
- `404 Not Found` - File doesn't exist
- `400 Bad Request` - Invalid path or trying to download a folder

**Implementation Notes:**
- Return file content as JSON if it's a JSON file (for direct loading into editor)
- For binary files, stream the file with proper headers
- Validate user has access to the file
- Handle large files efficiently (streaming)

---

### 4. Upload File

**Endpoint:** `POST /api/files/upload`

**Description:** Upload a new file or replace an existing file.

**Request:**
```http
POST https://art.tenderworld.org/api/files/upload
Content-Type: multipart/form-data
Cookie: session_id=xxx

file: [binary file data]
path: /my-projects
```

**Form Data:**
- `file` (File, required): The file to upload
- `path` (string, optional): Target directory path. Defaults to `/`.

**Response:**
```json
{
  "success": true,
  "file": {
    "name": "new-project.json",
    "path": "/my-projects/new-project.json",
    "type": "file",
    "size": 1024,
    "modified": "2024-01-15T11:00:00Z"
  }
}
```

**Status Codes:**
- `200 OK` - File uploaded successfully
- `201 Created` - File created (if you want to distinguish)
- `400 Bad Request` - Invalid file or path
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User doesn't have write access
- `409 Conflict` - File already exists (if overwriting is not allowed)
- `413 Payload Too Large` - File too large

**Implementation Notes:**
- Validate file size limits
- Sanitize file names
- Create directory structure if it doesn't exist
- Handle duplicate file names (append number or overwrite based on preference)
- Store files in user-specific directories: `/users/{userId}/files/{path}`

---

### 5. Create Folder

**Endpoint:** `POST /api/files/create-folder`

**Description:** Create a new folder.

**Request:**
```http
POST https://art.tenderworld.org/api/files/create-folder
Content-Type: application/json
Cookie: session_id=xxx

{
  "path": "/my-projects",
  "name": "new-folder"
}
```

**Request Body:**
```json
{
  "path": "/my-projects",
  "name": "new-folder"
}
```

**Response:**
```json
{
  "success": true,
  "folder": {
    "name": "new-folder",
    "path": "/my-projects/new-folder",
    "type": "folder",
    "modified": "2024-01-15T11:00:00Z"
  }
}
```

**Status Codes:**
- `200 OK` - Folder created successfully
- `400 Bad Request` - Invalid path or name
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User doesn't have write access
- `409 Conflict` - Folder already exists

**Implementation Notes:**
- Validate folder name (no invalid characters, not empty)
- Create full path if parent directories don't exist
- Return error if folder already exists (or merge based on preference)

---

### 6. Delete File/Folder

**Endpoint:** `DELETE /api/files/delete`

**Description:** Delete a file or folder.

**Query Parameters:**
- `path` (string, required): The full path to the file or folder to delete.

**Request:**
```http
DELETE https://art.tenderworld.org/api/files/delete?path=/my-projects/old-file.json
Cookie: session_id=xxx
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

**Status Codes:**
- `200 OK` - Deleted successfully
- `400 Bad Request` - Invalid path (e.g., trying to delete root)
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User doesn't have access
- `404 Not Found` - File/folder doesn't exist
- `409 Conflict` - Folder not empty (if deleting folder)

**Implementation Notes:**
- For folders, check if empty before deletion (or provide recursive delete option)
- Soft delete option (move to trash) is recommended
- Validate user owns the file/folder
- Log deletion for audit purposes

---

## Security Considerations

### 1. Authentication & Authorization
- All endpoints must require authentication
- Users should only access their own files
- Validate session tokens/cookies on every request
- Implement rate limiting to prevent abuse

### 2. Path Validation
- Prevent directory traversal attacks (`../`, absolute paths, etc.)
- Sanitize all user-provided paths
- Ensure users can't access files outside their directory
- Example validation:
  ```javascript
  // Remove leading/trailing slashes and normalize
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
  const userPath = `/users/${userId}/files/${normalizedPath}`;
  ```

### 3. File Size Limits
- Implement maximum file size limits (e.g., 10MB per file)
- Validate file types if needed
- Consider total storage quota per user

### 4. CORS Configuration
- Enable CORS for `https://studio.tenderworld.org` (or your editor domain)
- Include credentials: `Access-Control-Allow-Credentials: true`
- Set appropriate `Access-Control-Allow-Origin`

### 5. Input Validation
- Validate all input parameters
- Sanitize file names (remove invalid characters)
- Check file extensions if you restrict file types

---

## Storage Structure Recommendation

Recommended file system structure:

```
/storage
  /users
    /{userId}
      /files
        /{user-defined-path}
          /file1.json
          /file2.rz
          /subfolder
            /file3.json
```

Each user's files are isolated in their own directory.

---

## Example Implementation (Node.js/Express)

```javascript
// Example route handler for file listing
app.get('/api/files/list', authenticateUser, async (req, res) => {
  try {
    const { path = '/' } = req.query;
    const userId = req.user.id;
    
    // Validate and sanitize path
    const sanitizedPath = sanitizePath(path);
    const userFilePath = `/users/${userId}/files${sanitizedPath}`;
    
    // Check if path exists and user has access
    if (!await hasAccess(userId, userFilePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // List files
    const files = await listFiles(userFilePath);
    
    res.json({
      files: files.map(file => ({
        name: file.name,
        path: sanitizedPath + (sanitizedPath.endsWith('/') ? '' : '/') + file.name,
        type: file.isDirectory ? 'folder' : 'file',
        size: file.size,
        modified: file.modified.toISOString(),
        mimeType: file.mimeType
      })),
      path: sanitizedPath,
      parentPath: getParentPath(sanitizedPath)
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to sanitize paths
function sanitizePath(path) {
  // Remove leading/trailing slashes
  let sanitized = path.replace(/^\/+|\/+$/g, '');
  // Remove directory traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');
  // Remove any remaining dangerous characters
  sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f]/g, '');
  return '/' + sanitized;
}
```

---

## Testing Checklist

- [ ] Authentication check endpoint works
- [ ] Users can only access their own files
- [ ] File listing returns correct structure
- [ ] File upload works for various file types
- [ ] File download returns correct content
- [ ] Folder creation works
- [ ] File/folder deletion works
- [ ] Path traversal attacks are prevented
- [ ] Large files are handled correctly
- [ ] Error responses are appropriate
- [ ] CORS is configured correctly
- [ ] Rate limiting is in place

---

## Additional Recommendations

### 1. File Versioning
Consider adding file versioning to allow users to restore previous versions:
- `GET /api/files/versions?path=...` - List file versions
- `GET /api/files/version?path=...&version=...` - Get specific version

### 2. File Sharing
If you want to support sharing files between users:
- `POST /api/files/share` - Share a file with another user
- `GET /api/files/shared` - List files shared with the user

### 3. Search Functionality
- `GET /api/files/search?q=...` - Search files by name

### 4. Batch Operations
- `POST /api/files/batch-delete` - Delete multiple files at once
- `POST /api/files/batch-move` - Move multiple files

### 5. Quota Management
- Return user's storage quota in auth check response
- Implement quota checks before uploads

---

## API Base URL

All endpoints should be accessible at:
```
https://art.tenderworld.org/api/...
```

Ensure the base URL matches what's configured in the FileManager component (`editor/src/ui/FileManager.js`).

---

## Support & Questions

If you need clarification on any endpoint or have questions about the integration, please refer to the FileManager implementation in `editor/src/ui/FileManager.js` for reference on how the endpoints are being called.

