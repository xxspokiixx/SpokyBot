package com.openmausbot.test

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File

/** Serves the WebView camera captures to the system camera app over content:// URIs.
 * A FileProvider would be the usual pick, but this app ships no androidx and a MediaStore
 * output would need WRITE_EXTERNAL_STORAGE at targetSdk 28. */
class CaptureProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? = if (uri.lastPathSegment?.endsWith(".jpg") == true) "image/jpeg" else null

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val file = resolve(uri) ?: return null
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode))
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val cursor = MatrixCursor(arrayOf("_display_name", "mime_type", "_size"))
        val file = resolve(uri)
        if (file != null) cursor.addRow(arrayOf(file.name, "image/jpeg", file.length()))
        return cursor
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    private fun resolve(uri: Uri): File? {
        val name = uri.lastPathSegment ?: return null
        val context = context ?: return null
        val dir = File(context.cacheDir, MainActivity.CAPTURE_DIR)
        val file = File(dir, name)
        // Only files directly inside the capture directory: a crafted path segment must not read elsewhere.
        return if (file.canonicalFile.parentFile == dir.canonicalFile) file else null
    }
}
