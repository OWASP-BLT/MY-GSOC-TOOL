import { formatDate } from "../libs/utils.js";

export function renderActivity(activityData) {
    const activityList = document.getElementById('activity-list');
    const interactions = activityData.interactions || [];

    if (!activityList) return;

    if (interactions.length === 0) {
        activityList.innerHTML = `
            <p style="color: var(--text-secondary);">
                No activity tracked yet. GitHub Actions will populate this section with comments, 
                reviews, and interactions between you and your mentors.
            </p>
        `;
        return;
    }

    // Group interactions by type
    const groupedInteractions = interactions.reduce((acc, item) => {
        const type = item.type || 'other';
        if (!acc[type]) acc[type] = [];
        acc[type].push(item);
        return acc;
    }, {});

    const getIconForType = (type) => {
        const icons = {
            'comment': 'fa-comment',
            'review': 'fa-eye',
            'issue_comment': 'fa-comment-dots',
            'pr_review': 'fa-code-branch',
            'pr_comment': 'fa-comments',
            'commit_comment': 'fa-code',
            'mention': 'fa-at',
            'other': 'fa-bell'
        };
        return icons[type] || icons['other'];
    };

    const getColorForType = (type) => {
        const colors = {
            'comment': '#6366f1',
            'review': '#10b981',
            'issue_comment': '#f59e0b',
            'pr_review': '#8b5cf6',
            'pr_comment': '#ec4899',
            'commit_comment': '#3b82f6',
            'mention': '#ef4444',
            'other': '#6b7280'
        };
        return colors[type] || colors['other'];
    };

    // Sort interactions by date (newest first)
    interactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    activityList.innerHTML = `
        <div class="activity-stats mb-4">
            <div class="stat-grid">
                ${Object.entries(groupedInteractions).map(([type, items]) => `
                    <div class="stat-item">
                        <i class="fas ${getIconForType(type)}" style="color: ${getColorForType(type)}"></i>
                        <span class="stat-count">${items.length}</span>
                        <span class="stat-label">${type.replace('_', ' ')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="activity-timeline">
            ${interactions.map(item => `
                <div class="activity-item">
                    <div class="activity-icon" style="background-color: ${getColorForType(item.type)}20; color: ${getColorForType(item.type)}">
                        <i class="fas ${getIconForType(item.type)}"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-header">
                            <span class="activity-author">${item.author || 'Unknown'}</span>
                            <span class="activity-type">${item.type.replace('_', ' ')}</span>
                            <span class="activity-date">${formatDate(item.date)}</span>
                        </div>
                        <div class="activity-title">${item.title}</div>
                        ${item.body ? `<div class="activity-body">${item.body.substring(0, 200)}${item.body.length > 200 ? '...' : ''}</div>` : ''}
                        ${item.url ? `<a href="${item.url}" target="_blank" class="activity-link">
                            <i class="fas fa-external-link-alt"></i> View on GitHub
                        </a>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
