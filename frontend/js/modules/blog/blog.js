// =====================================================
// BLOG MODULE - Управление блогом
// =====================================================

let currentBlogFilter = 'all';

// Простой конвертер Markdown → HTML
function markdownToHtml(markdown) {
    // Если уже есть HTML теги, не трогаем
    if (markdown.includes('<p>') || markdown.includes('<h2>') || markdown.includes('<div>')) {
        return markdown;
    }
    
    let html = markdown;
    
    // Заголовки
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    
    // Жирный и курсив
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Списки
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Цитаты
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // Параграфы (строки, которые не являются тегами)
    const lines = html.split('\n');
    const formatted = lines.map(line => {
        line = line.trim();
        if (!line) return '';
        if (line.startsWith('<')) return line;  // Уже тег
        return `<p>${line}</p>`;
    });
    
    return formatted.join('\n');
}

// Получить список статей
async function renderBlogPosts(filter = 'all') {
    try {
        const token = getAuthToken();
        
        let url = `${API_URL}/blog?limit=100`;
        
        // Фильтры
        if (filter === 'published' || filter === 'draft') {
            url += `&status=${filter}`;
        } else if (filter === 'news' || filter === 'tips' || filter === 'stories' || filter === 'events') {
            url += `&status=published&category=${filter}`;
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderBlogPostsTable(data.posts);
        } else {
            toast.error(data.error || 'Ошибка загрузки статей');
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}

// Отрисовать таблицу статей
function renderBlogPostsTable(posts) {
    const table = document.getElementById('blogPostsTable');
    
    if (!posts || posts.length === 0) {
        table.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; opacity: 0.5;">Статей нет</td></tr>';
        return;
    }
    
    const categoryNames = {
        'news': 'Новости',
        'tips': 'Советы',
        'stories': 'Истории',
        'events': 'Мероприятия'
    };
    
    const statusNames = {
        'draft': 'Черновик',
        'published': 'Опубликовано',
        'archived': 'Архив'
    };
    
    table.innerHTML = posts.map(post => `
        <tr>
            <td>
                <strong>${post.title}</strong>
                ${post.image ? '<br><small style="opacity: 0.6;">📷 С изображением</small>' : ''}
            </td>
            <td>${categoryNames[post.category] || post.category}</td>
            <td>${post.author ? `${post.author.name} ${post.author.lastName || ''}` : '—'}</td>
            <td>
                <span class="status-badge ${post.status}">${statusNames[post.status]}</span>
            </td>
            <td>${post.views || 0}</td>
            <td>${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('ru') : '—'}</td>
            <td class="table-actions">
                <button class="table-btn" onclick="editBlogPost('${post._id}')">Редактировать</button>
                <button class="table-btn danger" onclick="deleteBlogPost('${post._id}', '${post.title.replace(/'/g, "\\'")}')">Удалить</button>
            </td>
        </tr>
    `).join('');
}

// Фильтрация статей
function filterBlogPosts(filter) {
    currentBlogFilter = filter;
    
    // Обновить активную кнопку
    document.querySelectorAll('.filters-search-row .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    renderBlogPosts(filter);
}

// Открыть модальное окно создания статьи
function openBlogPostModal() {
    document.getElementById('blogPostModalTitle').textContent = 'СОЗДАТЬ СТАТЬЮ';
    document.getElementById('blogPostForm').reset();
    document.getElementById('blogPostId').value = '';
    document.getElementById('blogImagePreview').innerHTML = '';
    document.getElementById('blogPostModal').classList.add('show');
}

// Закрыть модальное окно
function closeBlogPostModal() {
    document.getElementById('blogPostModal').classList.remove('show');
}

// Редактировать статью
async function editBlogPost(postId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/blog/${postId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const post = data.post;
            
            document.getElementById('blogPostModalTitle').textContent = 'РЕДАКТИРОВАТЬ СТАТЬЮ';
            document.getElementById('blogPostId').value = post._id;
            document.getElementById('blogTitle').value = post.title;
            document.getElementById('blogCategory').value = post.category;
            document.getElementById('blogExcerpt').value = post.excerpt;
            document.getElementById('blogContent').value = post.content;
            document.getElementById('blogMetaDescription').value = post.metaDescription || '';
            document.getElementById('blogMetaKeywords').value = post.metaKeywords || '';
            document.getElementById('blogStatus').value = post.status;
            
            // Показать превью изображения
            if (post.image) {
                document.getElementById('blogImagePreview').innerHTML = `
                    <img src="${post.image}" style="max-width: 200px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2);">
                `;
            } else {
                document.getElementById('blogImagePreview').innerHTML = '';
            }
            
            document.getElementById('blogPostModal').classList.add('show');
        } else {
            toast.error(data.error || 'Ошибка загрузки статьи');
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}

// Удалить статью
async function deleteBlogPost(postId, title) {
    if (!confirm(`Удалить статью "${title}"?`)) return;
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/blog/${postId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success('Статья удалена');
            renderBlogPosts(currentBlogFilter);
        } else {
            toast.error(data.error || 'Ошибка удаления');
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}

// Загрузить изображение для вставки в контент
async function uploadContentImage() {
    const input = document.getElementById('contentImageInput');
    input.click();
}

// Обработка загрузки изображения для контента
document.addEventListener('DOMContentLoaded', () => {
    const contentImageInput = document.getElementById('contentImageInput');
    if (contentImageInput) {
        contentImageInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const token = getAuthToken();
                const formData = new FormData();
                formData.append('image', file);
                
                // Показываем уведомление о загрузке
                toast.info('Загрузка изображения...');
                
                const response = await fetch(`${API_URL}/blog/upload-image`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Вставляем ссылку на изображение в textarea
                    const textarea = document.getElementById('blogContent');
                    const cursorPos = textarea.selectionStart;
                    const textBefore = textarea.value.substring(0, cursorPos);
                    const textAfter = textarea.value.substring(cursorPos);
                    
                    const imageTag = `\n<img src="${data.imagePath}" alt="Изображение" style="max-width: 100%; border-radius: 8px; margin: 20px 0;">\n`;
                    
                    textarea.value = textBefore + imageTag + textAfter;
                    
                    // Устанавливаем курсор после вставленного тега
                    textarea.selectionStart = textarea.selectionEnd = cursorPos + imageTag.length;
                    textarea.focus();
                    
                    toast.success('Изображение добавлено в текст!');
                } else {
                    toast.error(data.error || 'Ошибка загрузки');
                }
                
                // Очищаем input
                e.target.value = '';
            } catch (error) {
                toast.error('Ошибка загрузки изображения');
            }
        });
    }
});

// Обработчик формы создания/редактирования
function initBlogHandlers() {
    const blogPostForm = document.getElementById('blogPostForm');
    
    if (blogPostForm) {
        blogPostForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const postId = document.getElementById('blogPostId').value;
            const title = document.getElementById('blogTitle').value;
            const category = document.getElementById('blogCategory').value;
            const excerpt = document.getElementById('blogExcerpt').value;
            const rawContent = document.getElementById('blogContent').value;
            const metaDescription = document.getElementById('blogMetaDescription').value;
            const metaKeywords = document.getElementById('blogMetaKeywords').value;
            const status = document.getElementById('blogStatus').value;
            const imageFile = document.getElementById('blogImage').files[0];
            
            // 🎨 Конвертируем Markdown в HTML (если не HTML уже)
            const content = markdownToHtml(rawContent);
            
            try {
                const token = getAuthToken();
                const formData = new FormData();
                
                formData.append('title', title);
                formData.append('category', category);
                formData.append('excerpt', excerpt);
                formData.append('content', content);
                formData.append('metaDescription', metaDescription);
                formData.append('metaKeywords', metaKeywords);
                formData.append('status', status);
                
                if (imageFile) {
                    formData.append('image', imageFile);
                }
                
                const url = postId ? `${API_URL}/blog/${postId}` : `${API_URL}/blog`;
                const method = postId ? 'PATCH' : 'POST';
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                
                const data = await response.json();
                
                if (data.success) {
                    toast.success(postId ? 'Статья обновлена!' : 'Статья создана!');
                    closeBlogPostModal();
                    renderBlogPosts(currentBlogFilter);
                } else {
                    toast.error(data.error || 'Ошибка сохранения');
                }
            } catch (error) {
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
    
    // Превью изображения при выборе
    const blogImage = document.getElementById('blogImage');
    if (blogImage) {
        blogImage.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('blogImagePreview').innerHTML = `
                        <img src="${e.target.result}" style="max-width: 200px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2);">
                    `;
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

