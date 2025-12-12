#!/usr/bin/env python3
"""
Check if GitHub Pages URL is configured correctly for forked repositories.
"""

import os
import sys
import json
import requests

# GitHub API setup
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
REPO = os.environ.get('GITHUB_REPOSITORY')

if not GITHUB_TOKEN or not REPO:
    print("ERROR: GITHUB_TOKEN and GITHUB_REPOSITORY must be set")
    sys.exit(1)

headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json'
}

def check_if_fork():
    """Check if the repository is a fork."""
    url = f'https://api.github.com/repos/{REPO}'
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"ERROR: Failed to get repo info: {response.status_code}")
        return False, None
    
    repo_info = response.json()
    is_fork = repo_info.get('fork', False)
    parent_repo = repo_info.get('parent', {}).get('full_name', 'none') if is_fork else None
    
    print(f"Repository: {REPO}")
    print(f"Is Fork: {is_fork}")
    print(f"Parent Repo: {parent_repo}")
    
    return is_fork, parent_repo

def check_pages_url():
    """Check GitHub Pages configuration."""
    url = f'https://api.github.com/repos/{REPO}/pages'
    response = requests.get(url, headers=headers)
    
    owner, repo_name = REPO.split('/')
    expected_url = f'https://{owner}.github.io/{repo_name}/'
    default_url = 'https://OWASP-BLT.github.io/MY-GSOC-TOOL/'
    
    if response.status_code == 404:
        print("GitHub Pages is not configured")
        return {
            'needs_action': True,
            'issue_type': 'not_configured',
            'pages_url': None,
            'expected_url': expected_url
        }
    elif response.status_code != 200:
        print(f"ERROR: Failed to get pages info: {response.status_code}")
        return {'needs_action': False}
    
    pages_info = response.json()
    pages_url = pages_info.get('html_url', '')
    pages_status = pages_info.get('status', '')
    
    print(f"Pages URL: {pages_url}")
    print(f"Pages Status: {pages_status}")
    
    if pages_url == default_url:
        return {
            'needs_action': True,
            'issue_type': 'default_url',
            'pages_url': pages_url,
            'expected_url': expected_url
        }
    elif pages_url != expected_url and pages_status == 'built':
        # Could be a custom domain - check if it's intentional
        return {
            'needs_action': True,
            'issue_type': 'wrong_url',
            'pages_url': pages_url,
            'expected_url': expected_url
        }
    
    print("GitHub Pages is correctly configured")
    return {'needs_action': False, 'pages_url': pages_url}

def check_existing_issues():
    """Check if there are already open issues with the label."""
    url = f'https://api.github.com/repos/{REPO}/issues'
    params = {
        'state': 'open',
        'labels': 'github-pages-setup',
        'per_page': 100
    }
    response = requests.get(url, headers=headers, params=params)
    
    if response.status_code != 200:
        print(f"ERROR: Failed to get issues: {response.status_code}")
        return 0
    
    issues = response.json()
    count = len(issues)
    print(f"Found {count} existing open issue(s) with github-pages-setup label")
    return count

def create_issue(issue_type, pages_url=None, expected_url=None):
    """Create an issue to alert the user."""
    owner, repo_name = REPO.split('/')
    
    if issue_type == 'not_configured':
        title = "⚠️ Action Required: Configure GitHub Pages for Your Dashboard"
        body = f"""## GitHub Pages Not Configured

Hello! 👋

It looks like you've forked this GSoC Dashboard repository, but **GitHub Pages hasn't been configured yet** for your fork.

### What You Need to Do:

1. Go to your repository's **Settings** → **Pages**
2. Under "Source", select **GitHub Actions** (not "Deploy from a branch")
3. Save the changes
4. Wait a few minutes for the deployment to complete

### After Setup:

Your dashboard will be available at:
```
{expected_url}
```

### Need Help?

Check out the [Setup Guide](https://github.com/{REPO}/blob/main/SETUP.md) for detailed instructions.

---

**Note:** This issue was automatically created by a GitHub Action. Once you've configured GitHub Pages, this issue will be automatically closed on the next check (daily at 6 AM UTC or when you push to main).
"""
    
    elif issue_type == 'default_url':
        title = "⚠️ Action Required: Update Your GitHub Pages URL"
        body = f"""## GitHub Pages URL Still Using Default Configuration

Hello! 👋

It looks like you've forked this GSoC Dashboard repository, but your **GitHub Pages URL is still pointing to the original repository** instead of your fork.

### Current Issue:

Your GitHub Pages is pointing to: `{pages_url}`

But it should be: `{expected_url}`

### What You Need to Do:

1. Go to your repository's **Settings** → **Pages**
2. Make sure the "Source" is set to **GitHub Actions**
3. If it's set to "Deploy from a branch", change it to **GitHub Actions**
4. Save the changes and wait for the automatic deployment

### After Setup:

Your dashboard will be available at:
```
{expected_url}
```

### Need Help?

Check out the [Setup Guide](https://github.com/{REPO}/blob/main/SETUP.md) for detailed instructions.

---

**Note:** This issue was automatically created by a GitHub Action to help ensure your dashboard is properly configured. Once the URL is corrected, this issue will be automatically closed on the next check (daily at 6 AM UTC or when you push to main).
"""
    
    else:  # wrong_url
        title = "⚠️ Action Required: Verify Your GitHub Pages URL"
        body = f"""## GitHub Pages URL Mismatch Detected

Hello! 👋

Your GitHub Pages URL doesn't match the expected URL for your fork.

### Current Configuration:

- **Current URL:** `{pages_url}`
- **Expected URL:** `{expected_url}`

### What You Need to Do:

1. Go to your repository's **Settings** → **Pages**
2. Verify the "Source" is set to **GitHub Actions**
3. Ensure there are no custom domain configurations unless intentional
4. Save any changes and wait for redeployment

### Need Help?

If you're using a custom domain, you can safely close this issue. Otherwise, check out the [Setup Guide](https://github.com/{REPO}/blob/main/SETUP.md) for detailed instructions.

---

**Note:** This issue was automatically created by a GitHub Action. Once the configuration is corrected, this issue will be automatically closed on the next check.
"""
    
    url = f'https://api.github.com/repos/{REPO}/issues'
    data = {
        'title': title,
        'body': body,
        'labels': ['github-pages-setup', 'automated']
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 201:
        print("Issue created successfully!")
        return True
    else:
        print(f"ERROR: Failed to create issue: {response.status_code}")
        print(response.text)
        return False

def close_resolved_issues():
    """Close issues that are no longer relevant."""
    url = f'https://api.github.com/repos/{REPO}/issues'
    params = {
        'state': 'open',
        'labels': 'github-pages-setup',
        'per_page': 100
    }
    response = requests.get(url, headers=headers, params=params)
    
    if response.status_code != 200:
        print(f"ERROR: Failed to get issues: {response.status_code}")
        return
    
    issues = response.json()
    
    for issue in issues:
        issue_number = issue['number']
        print(f"Closing issue #{issue_number} as GitHub Pages is now correctly configured")
        
        # Add a comment before closing
        comment_url = f'https://api.github.com/repos/{REPO}/issues/{issue_number}/comments'
        comment_data = {
            'body': "✅ GitHub Pages is now correctly configured! Your dashboard should be accessible at the correct URL. Closing this issue automatically."
        }
        comment_response = requests.post(comment_url, headers=headers, json=comment_data)
        if comment_response.status_code not in [200, 201]:
            print(f"WARNING: Failed to add comment to issue #{issue_number}: {comment_response.status_code}")
        
        # Close the issue
        update_url = f'https://api.github.com/repos/{REPO}/issues/{issue_number}'
        update_data = {'state': 'closed'}
        close_response = requests.patch(update_url, headers=headers, json=update_data)
        if close_response.status_code != 200:
            print(f"ERROR: Failed to close issue #{issue_number}: {close_response.status_code}")
        else:
            print(f"Successfully closed issue #{issue_number}")

def write_summary(content):
    """Write summary to GITHUB_STEP_SUMMARY if available."""
    summary_file = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_file:
        try:
            with open(summary_file, 'a') as f:
                f.write(content)
        except Exception as e:
            print(f"WARNING: Could not write to step summary: {e}")
    else:
        print("Note: GITHUB_STEP_SUMMARY not set, skipping summary output")

def main():
    # Check if this is a fork
    is_fork, parent_repo = check_if_fork()
    
    if not is_fork:
        print("ℹ️ Repository is not a fork - skipping GitHub Pages URL check")
        write_summary("### Workflow Summary\n\nℹ️ Repository is not a fork - skipping GitHub Pages URL check\n")
        return
    
    # Check GitHub Pages URL
    result = check_pages_url()
    
    if result.get('needs_action'):
        # Check if an issue already exists
        existing_count = check_existing_issues()
        
        if existing_count == 0:
            # Create a new issue
            create_issue(
                result['issue_type'],
                result.get('pages_url'),
                result.get('expected_url')
            )
    else:
        # Close any open issues as they're resolved
        close_resolved_issues()
    
    # Write summary
    summary = "### Workflow Summary\n\n"
    summary += f"✅ Repository is a fork\n"
    summary += f"- **Parent Repository:** {parent_repo}\n\n"
    
    if result.get('needs_action'):
        if result['issue_type'] == 'not_configured':
            summary += "⚠️ **GitHub Pages not configured**\n"
        else:
            summary += "⚠️ **GitHub Pages URL needs update**\n"
            summary += f"- Current: {result.get('pages_url')}\n"
            summary += f"- Expected: {result.get('expected_url')}\n"
    else:
        summary += "✅ **GitHub Pages is correctly configured**\n"
        summary += f"- URL: {result.get('pages_url')}\n"
    
    write_summary(summary)

if __name__ == '__main__':
    main()
