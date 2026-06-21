import os
import uuid
import datetime
import logging
from firebase_config import FIREBASE_ENABLED, db_client, storage_bucket

logger = logging.getLogger(__name__)

# ==========================================
# FILE UPLOAD UTILITIES (FIREBASE STORAGE ONLY)
# ==========================================
def save_file(file_obj, filename, folder='photos'):
    """
    Saves file to Firebase Storage bucket. Falls back to local disk storage if Firebase Storage fails or is not initialized.
    """
    if not file_obj or file_obj.filename == '':
        return None
        
    unique_filename = f"{uuid.uuid4().hex}_{filename}"
    
    if FIREBASE_ENABLED and storage_bucket:
        try:
            import urllib.parse
            blob_path = f"{folder}/{unique_filename}"
            blob = storage_bucket.blob(blob_path)
            file_obj.seek(0)
            blob.upload_from_file(file_obj, content_type=file_obj.content_type, timeout=3, retry=None)
            
            # Construct standard Firebase Storage public link that works regardless of ACL settings
            encoded_path = urllib.parse.quote(blob_path, safe='')
            public_url = f"https://firebasestorage.googleapis.com/v0/b/{storage_bucket.name}/o/{encoded_path}?alt=media"
            return public_url
        except Exception as e:
            logger.warning(f"Firebase Storage upload failed: {e}. Falling back to local storage.")
            # Fall through to local fallback
            
    # Local fallback
    try:
        local_dir = os.path.join('static', 'uploads', folder)
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, unique_filename)
        file_obj.seek(0)
        file_obj.save(local_path)
        return f"/static/uploads/{folder}/{unique_filename}"
    except Exception as local_err:
        logger.error(f"Failed local file upload fallback: {local_err}")
        raise RuntimeError(f"Failed to upload photo: {local_err}")


# In-memory cache for Firestore queries
_user_cache = {}
_user_info_cache = {}

def _get_user_cache(user_id):
    if user_id not in _user_cache:
        _user_cache[user_id] = {
            'contacts': None,
            'groups': None,
            'notifications': None,
            'categories': None
        }
    return _user_cache[user_id]

def clear_user_cache(user_id, key=None):
    if user_id in _user_cache:
        if key:
            _user_cache[user_id][key] = None
        else:
            _user_cache[user_id] = {
                'contacts': None,
                'groups': None,
                'notifications': None,
                'categories': None
            }

# ==========================================
# USER PROFILE OPERATIONS (FIRESTORE)
# ==========================================
def get_user(user_id):
    if user_id in _user_info_cache:
        return _user_info_cache[user_id]
    try:
        doc = db_client.collection('users').document(user_id).get()
        if doc.exists:
            user_data = doc.to_dict()
            _user_info_cache[user_id] = user_data
            return user_data
    except Exception as e:
        logger.error(f"Firebase get_user error: {e}")
        raise RuntimeError(f"Database query failed: {e}")
    return None

def create_or_update_user(user_id, email, full_name, photo_url=None):
    user_data = {
        "userId": user_id,
        "email": email,
        "fullName": full_name,
        "photo": photo_url or "/static/images/default-avatar.svg",
        "createdAt": datetime.datetime.now().isoformat()
    }
    
    try:
        doc_ref = db_client.collection('users').document(user_id)
        existing = doc_ref.get()
        if existing.exists:
            existing_data = existing.to_dict()
            user_data["createdAt"] = existing_data.get("createdAt", user_data["createdAt"])
            if not photo_url:
                user_data["photo"] = existing_data.get("photo", user_data["photo"])
        
        doc_ref.set(user_data)
        _user_info_cache[user_id] = user_data
        return user_data
    except Exception as e:
        logger.error(f"Firebase create_or_update_user error: {e}")
        raise RuntimeError(f"Database write failed: {e}")


# ==========================================
# CONTACTS CRUD OPERATIONS (FIRESTORE)
# ==========================================
def get_contacts(user_id):
    cache = _get_user_cache(user_id)
    if cache['contacts'] is not None:
        return cache['contacts']
    try:
        docs = db_client.collection('contacts').where('userId', '==', user_id).stream()
        contacts_list = []
        for doc in docs:
            data = doc.to_dict()
            data['contactId'] = doc.id
            contacts_list.append(data)
        cache['contacts'] = contacts_list
        return contacts_list
    except Exception as e:
        logger.error(f"Firebase get_contacts error: {e}")
        raise RuntimeError(f"Database query failed: {e}")

def get_contact(user_id, contact_id):
    cache = _get_user_cache(user_id)
    if cache['contacts'] is not None:
        for c in cache['contacts']:
            if c.get('contactId') == contact_id:
                return c
    try:
        doc = db_client.collection('contacts').document(contact_id).get()
        if doc.exists:
            data = doc.to_dict()
            if data.get('userId') == user_id:
                data['contactId'] = doc.id
                return data
    except Exception as e:
        logger.error(f"Firebase get_contact error: {e}")
        raise RuntimeError(f"Database query failed: {e}")
    return None

def create_contact(user_id, contact_data):
    contact_id = uuid.uuid4().hex
    contact_data['contactId'] = contact_id
    contact_data['userId'] = user_id
    contact_data['createdDate'] = datetime.datetime.now().isoformat()
    contact_data['favorite'] = bool(contact_data.get('favorite', False))
    contact_data['emergency'] = bool(contact_data.get('emergency', False))
    if 'photo' not in contact_data:
        contact_data['photo'] = None
        
    try:
        db_client.collection('contacts').document(contact_id).set(contact_data)
        clear_user_cache(user_id, 'contacts')
        return contact_data
    except Exception as e:
        logger.error(f"Firebase create_contact error: {e}")
        raise RuntimeError(f"Database write failed: {e}")

def update_contact(user_id, contact_id, contact_data):
    contact_data['contactId'] = contact_id
    contact_data['userId'] = user_id
    contact_data['favorite'] = bool(contact_data.get('favorite', False))
    contact_data['emergency'] = bool(contact_data.get('emergency', False))
    
    try:
        # Check cache first for existing contact details to save a Firestore read
        cache = _get_user_cache(user_id)
        existing_data = None
        if cache['contacts'] is not None:
            for c in cache['contacts']:
                if c.get('contactId') == contact_id:
                    existing_data = c
                    break
        
        if not existing_data:
            doc_ref = db_client.collection('contacts').document(contact_id)
            existing = doc_ref.get()
            if existing.exists:
                existing_data = existing.to_dict()

        if existing_data and existing_data.get('userId') == user_id:
            contact_data['createdDate'] = existing_data.get('createdDate', datetime.datetime.now().isoformat())
            if not contact_data.get('photo'):
                contact_data['photo'] = existing_data.get('photo')
            db_client.collection('contacts').document(contact_id).set(contact_data, merge=True)
            clear_user_cache(user_id, 'contacts')
            return contact_data
    except Exception as e:
        logger.error(f"Firebase update_contact error: {e}")
        raise RuntimeError(f"Database update failed: {e}")
    return None

def delete_contact(user_id, contact_id):
    try:
        doc_ref = db_client.collection('contacts').document(contact_id)
        doc_ref.delete()
        clear_user_cache(user_id, 'contacts')
        return True
    except Exception as e:
        logger.error(f"Firebase delete_contact error: {e}")
        raise RuntimeError(f"Database deletion failed: {e}")


# ==========================================
# GROUPS OPERATIONS (FIRESTORE)
# ==========================================
def get_groups(user_id):
    cache = _get_user_cache(user_id)
    if cache['groups'] is not None:
        return cache['groups']
    try:
        docs = db_client.collection('groups').where('userId', '==', user_id).stream()
        groups_list = []
        for doc in docs:
            data = doc.to_dict()
            data['groupId'] = doc.id
            groups_list.append(data)
        cache['groups'] = groups_list
        return groups_list
    except Exception as e:
        logger.error(f"Firebase get_groups error: {e}")
        raise RuntimeError(f"Database query failed: {e}")

def create_group(user_id, group_name, description=""):
    group_id = uuid.uuid4().hex
    group_data = {
        "groupId": group_id,
        "userId": user_id,
        "groupName": group_name,
        "description": description,
        "contacts": []
    }
    
    try:
        db_client.collection('groups').document(group_id).set(group_data)
        clear_user_cache(user_id, 'groups')
        return group_data
    except Exception as e:
        logger.error(f"Firebase create_group error: {e}")
        raise RuntimeError(f"Database write failed: {e}")

def update_group(user_id, group_id, group_name, description, contact_ids=None):
    try:
        doc_ref = db_client.collection('groups').document(group_id)
        doc = doc_ref.get()
        if doc.exists and doc.to_dict().get('userId') == user_id:
            update_data = {
                "groupName": group_name,
                "description": description
            }
            if contact_ids is not None:
                update_data["contacts"] = contact_ids
            doc_ref.update(update_data)
            clear_user_cache(user_id, 'groups')
            return True
    except Exception as e:
        logger.error(f"Firebase update_group error: {e}")
        raise RuntimeError(f"Database update failed: {e}")
    return False

def delete_group(user_id, group_id):
    try:
        doc_ref = db_client.collection('groups').document(group_id)
        doc_ref.delete()
        clear_user_cache(user_id, 'groups')
        return True
    except Exception as e:
        logger.error(f"Firebase delete_group error: {e}")
        raise RuntimeError(f"Database deletion failed: {e}")


# ==========================================
# NOTIFICATIONS OPERATIONS (FIRESTORE)
# ==========================================
def get_notifications(user_id):
    cache = _get_user_cache(user_id)
    if cache['notifications'] is not None:
        return cache['notifications']
    try:
        docs = db_client.collection('notifications').where('userId', '==', user_id).stream()
        notifications_list = []
        for doc in docs:
            data = doc.to_dict()
            data['notificationId'] = doc.id
            notifications_list.append(data)
        notifications_list.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        cache['notifications'] = notifications_list
        return notifications_list
    except Exception as e:
        logger.error(f"Firebase get_notifications error: {e}")
        raise RuntimeError(f"Database query failed: {e}")

def create_notification(user_id, notif_type, message):
    notification_id = uuid.uuid4().hex
    notif_data = {
        "notificationId": notification_id,
        "userId": user_id,
        "type": notif_type,
        "message": message,
        "read": False,
        "createdAt": datetime.datetime.now().isoformat()
    }
    
    try:
        db_client.collection('notifications').document(notification_id).set(notif_data)
        clear_user_cache(user_id, 'notifications')
        return notif_data
    except Exception as e:
        logger.error(f"Firebase create_notification error: {e}")
        raise RuntimeError(f"Database write failed: {e}")

def mark_notifications_read(user_id):
    try:
        docs = db_client.collection('notifications').where('userId', '==', user_id).where('read', '==', False).stream()
        batch = db_client.batch()
        count = 0
        for doc in docs:
            batch.update(doc.reference, {"read": True})
            count += 1
        if count > 0:
            batch.commit()
            clear_user_cache(user_id, 'notifications')
        return True
    except Exception as e:
        logger.error(f"Firebase mark_notifications_read error: {e}")
        raise RuntimeError(f"Database write batch failed: {e}")


# ==========================================
# CATEGORIES OPERATIONS (FIRESTORE)
# ==========================================
DEFAULT_CATEGORIES = ["Family", "Friends", "Work", "Clients", "Business", "Personal", "Emergency"]

def get_categories(user_id):
    cache = _get_user_cache(user_id)
    if cache['categories'] is not None:
        return cache['categories']
    try:
        doc = db_client.collection('categories').document(user_id).get()
        if doc.exists:
            cats = doc.to_dict().get('categories', DEFAULT_CATEGORIES)
            cache['categories'] = cats
            return cats
    except Exception as e:
        logger.error(f"Firebase get_categories error: {e}")
        raise RuntimeError(f"Database query failed: {e}")
    cache['categories'] = DEFAULT_CATEGORIES
    return DEFAULT_CATEGORIES

def add_category(user_id, category_name):
    category_name = category_name.strip()
    if not category_name:
        return None
        
    current = get_categories(user_id)
    if category_name in current:
        return current
        
    current.append(category_name)
    
    try:
        db_client.collection('categories').document(user_id).set({"categories": current})
        clear_user_cache(user_id, 'categories')
        return current
    except Exception as e:
        logger.error(f"Firebase add_category error: {e}")
        raise RuntimeError(f"Database write failed: {e}")
