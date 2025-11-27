/*
 * Cloudflare Worker 腳本 (修復版 - 使用標準 Worker 語法)
 * 處理 /api/ 路由並與 KV 互動
 * * 備註: 這是標準 Worker 格式 (export default { fetch })，
 * 它比 Pages Functions 格式 (export function onRequest) 更穩定，
 * 可避免某些編譯錯誤。
 */

// 輔助函式：回應 JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { 
      'Content-Type': 'application/json',
      // 允許跨域請求，Pages & Workers 預設允許，但加上更保險
      'Access-Control-Allow-Origin': '*' 
    },
    status: status,
  });
}

// 輔助函式：回應錯誤
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// 取得使用者 ID (來自客戶端傳送的 Header)
function getUserId(request) {
  return request.headers.get('X-User-Token');
}

// ---------------------------------
// CRUD 處理邏輯
// ---------------------------------

async function handleListNotes(env, userId) {
  const list = await env.NOTES_KV.list({ prefix: `notes:${userId}:` });
  const notes = [];
  for (const key of list.keys) {
    const noteContent = await env.NOTES_KV.get(key.name);
    if (noteContent) {
      notes.push(JSON.parse(noteContent));
    }
  }
  return jsonResponse(notes);
}

async function handleCreateNote(request, env, userId) {
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
  await env.NOTES_KV.put(key, JSON.stringify(newNote));
  
  return jsonResponse(newNote, 201);
}

async function handleUpdateNote(request, env, userId, noteId) {
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
    updatedAt: Date.now(),
  };

  await env.NOTES_KV.put(key, JSON.stringify(updatedNote));
  
  return jsonResponse(updatedNote);
}

async function handleDeleteNote(env, userId, noteId) {
  const key = `notes:${userId}:${noteId}`;
  await env.NOTES_KV.delete(key);
  
  return jsonResponse({ success: true }, 200);
}


// ---------------------------------
// Cloudflare Worker 主入口
// ---------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // 取得使用者 ID (必須先驗證)
    const userId = getUserId(request);
    if (!userId) return errorResponse('缺少使用者憑證 (X-User-Token)', 401);

    // 路由: /api/notes
    if (path === '/api/notes') {
      if (method === 'GET') {
        return handleListNotes(env, userId);
      }
      if (method === 'POST') {
        return handleCreateNote(request, env, userId);
      }
    }
    
    // 路由: /api/notes/:id
    const match = path.match(/^\/api\/notes\/([a-fA-F0-9-]{36})$/);
    if (match) {
      const noteId = match[1]; // 抓取 UUID
      if (method === 'PUT') {
        return handleUpdateNote(request, env, userId, noteId);
      }
      if (method === 'DELETE') {
        return handleDeleteNote(env, userId, noteId);
      }
    }

    // 未匹配的 API 路由
    if (path.startsWith('/api/')) {
        return errorResponse('API 路由不存在或方法不允許', 404);
    }
    
    // 將所有其他請求 (Pages/靜態檔案) 傳遞給 Pages 靜態伺服器
    // (這在 Pages Functions 環境中通常會自動發生，但我們仍然返回 404 以防萬一)
    return errorResponse('找不到資源', 404);
  },
};
