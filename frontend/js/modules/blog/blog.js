// =====================================================
// BLOG MODULE - Управление блогом
// =====================================================

let currentBlogFilter = 'all';

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
            const content = document.getElementById('blogContent').value;
            const metaDescription = document.getElementById('blogMetaDescription').value;
            const metaKeywords = document.getElementById('blogMetaKeywords').value;
            const status = document.getElementById('blogStatus').value;
            const imageFile = document.getElementById('blogImage').files[0];
            
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

