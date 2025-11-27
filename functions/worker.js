/*
 * Cloudflare Worker 腳本 (Pages Functions)
 * 處理 /api/ 路由並與 KV 互動
 * * 環境變數要求: 必須綁定一個 KV Namespace，名稱為 NOTES_KV
 */

// 輔助函式：回應 JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
    status: status,
  });
}

// 輔助函式：回應錯誤
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// 取得使用者 ID (來自客戶端傳送的 Header)
// !! 提醒: 這是為了示範 KV 隔離，安全性需額外加強 !!
function getUserId(request) {
  return request.headers.get('X-User-Token');
}

// ---------------------------------
// API 路由處理邏輯
// ---------------------------------

// 1. 取得所有筆記 (List)
async function handleListNotes(request, env) {
  const userId = getUserId(request);
  if (!userId) return errorResponse('缺少使用者憑證 (X-User-Token)', 401);

  // 取得該使用者 ID 的所有 KV 鍵 (使用 prefix 來隔離不同使用者的資料)
  const list = await env.NOTES_KV.list({ prefix: `notes:${userId}:` });
  
  const notes = [];
  for (const key of list.keys) {
    // 取得內容，並解析為 JSON
    const noteContent = await env.NOTES_KV.get(key.name);
    if (noteContent) {
      notes.push(JSON.parse(noteContent));
    }
  }
  
  return jsonResponse(notes);
}

// 2. 建立新筆記 (Create)
async function handleCreateNote(request, env) {
  const userId = getUserId(request);
  if (!userId) return errorResponse('缺少使用者憑證', 401);

  const { content } = await request.json();
  if (typeof content !== 'string') {
    return errorResponse('內容必須是字串', 400);
  }

  const noteId = crypto.randomUUID();
  const timestamp = Date.now();
  
  const newNote = {
    id: noteId,
    content: content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const key = `notes:${userId}:${noteId}`;
  // 儲存到 KV
  await env.NOTES_KV.put(key, JSON.stringify(newNote));
  
  return jsonResponse(newNote, 201);
}

// 4. 更新筆記 (Update)
async function handleUpdateNote(request, env, noteId) {
  const userId = getUserId(request);
  if (!userId) return errorResponse('缺少使用者憑證', 401);

  const key = `notes:${userId}:${noteId}`;
  
  const existingNoteJSON = await env.NOTES_KV.get(key);
  if (!existingNoteJSON) {
    return errorResponse('找不到要更新的筆記', 404);
  }
  
  const existingNote = JSON.parse(existingNoteJSON);
  const { content } = await request.json();

  const updatedNote = {
    ...existingNote,
    content: content ?? existingNote.content,
    updatedAt: Date.now(), // 更新時間戳記
  };

  await env.NOTES_KV.put(key, JSON.stringify(updatedNote));
  
  return jsonResponse(updatedNote);
}

// 5. 刪除筆記 (Delete)
async function handleDeleteNote(request, env, noteId) {
  const userId = getUserId(request);
  if (!userId) return errorResponse('缺少使用者憑證', 401);
  
  const key = `notes:${userId}:${noteId}`;
  
  // 檢查是否存在 (可選)
  const existingNote = await env.NOTES_KV.get(key);
  if (!existingNote) {
    return errorResponse('找不到要刪除的筆記', 404);
  }
  
  await env.NOTES_KV.delete(key);
  
  return jsonResponse({ success: true }, 200);
}


// ---------------------------------
// Cloudflare Worker 主入口
// ---------------------------------
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 檢查是否為 /api/notes 或 /api/notes/:id
  
  // /api/notes
  if (path === '/api/notes') {
    if (request.method === 'GET') {
      return handleListNotes(request, env);
    }
    if (request.method === 'POST') {
      return handleCreateNote(request, env);
    }
  }
  
  // /api/notes/:id (使用正規表達式來匹配 UUID)
  const match = path.match(/^\/api\/notes\/([a-fA-F0-9-]{36})$/);
  if (match) {
    const noteId = match[1]; // 抓取 UUID
    if (request.method === 'PUT') {
      return handleUpdateNote(request, env, noteId);
    }
    if (request.method === 'DELETE') {
      return handleDeleteNote(request, env, noteId);
    }
    // GET /api/notes/:id 也是可以的，但目前前端不需要
  }

  // 如果路由不是 /api/*，則交給 Pages 處理靜態檔案 (或返回 404)
  return errorResponse('API 路由不存在或方法不允許', 404);
} we
