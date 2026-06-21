import os
import uuid
import datetime
import logging
import json
from firebase_config import FIREBASE_ENABLED, db_client, storage_bucket

logger = logging.getLogger(__name__)

# Track if Firestore connection is operational
FIRESTORE_WORKING = False
if FIREBASE_ENABLED and db_client:
    try:
        from firebase_config import cred
        # Run a fast, non-blocking network verification to check key validity
        cred.get_access_token()
        FIRESTORE_WORKING = True
        logger.info("Firestore connection verified and working.")
    except Exception as e:
        logger.warning(f"Firestore credential verification failed: {e}. Using local JSON database fallback.")
        FIRESTORE_WORKING = False

LOCAL_DB_FILE = os.path.join(os.path.dirname(__file__), 'local_db.json')

def _load_local_db():
    if not os.path.exists(LOCAL_DB_FILE):
        default_db = {
            "users": {},
            "contacts": {},
            "groups": {},
            "notifications": {},
            "categories": {}
        }
        try:
            with open(LOCAL_DB_FILE, 'w') as f:
                json.dump(default_db, f, indent=4)
        except Exception as e:
            logger.error(f"Error initializing local_db.json: {e}")
        return default_db
    try:
        with open(LOCAL_DB_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading local_db.json: {e}")
        return {"users": {}, "contacts": {}, "groups": {}, "notifications": {}, "categories": {}}

def _save_local_db(data):
    try:
        with open(LOCAL_DB_FILE, 'w') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving local_db.json: {e}")

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
# USER PROFILE OPERATIONS (FIRESTORE / LOCAL)
# ==========================================
def get_user(user_id):
    global FIRESTORE_WORKING
    if user_id in _user_info_cache:
        return _user_info_cache[user_id]
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc = db_client.collection('users').document(user_id).get()
            if doc.exists:
                user_data = doc.to_dict()
                _user_info_cache[user_id] = user_data
                return user_data
        except Exception as e:
            logger.warning(f"Firebase get_user error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    user_data = db["users"].get(user_id)
    if user_data:
        _user_info_cache[user_id] = user_data
        return user_data
    return None

def create_or_update_user(user_id, email, full_name, photo_url=None):
    global FIRESTORE_WORKING
    user_data = {
        "userId": user_id,
        "email": email.strip().lower(),
        "fullName": full_name,
        "photo": photo_url or "/static/images/default-avatar.svg",
        "createdAt": datetime.datetime.now().isoformat()
    }
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
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
            logger.warning(f"Firebase create_or_update_user error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    existing_data = db["users"].get(user_id)
    if existing_data:
        user_data["createdAt"] = existing_data.get("createdAt", user_data["createdAt"])
        if not photo_url:
            user_data["photo"] = existing_data.get("photo", user_data["photo"])
    db["users"][user_id] = user_data
    _save_local_db(db)
    _user_info_cache[user_id] = user_data
    return user_data

def get_user_by_email(email):
    global FIRESTORE_WORKING
    email_clean = email.strip().lower()
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            docs = db_client.collection('users').where('email', '==', email_clean).limit(1).stream()
            for doc in docs:
                user_data = doc.to_dict()
                user_data['userId'] = doc.id
                return user_data
        except Exception as e:
            logger.warning(f"Firebase get_user_by_email error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    for uid, user_data in db["users"].items():
        if user_data.get('email', '').strip().lower() == email_clean:
            return user_data
    return None

def create_local_user(user_id, email, full_name, password_hash):
    global FIRESTORE_WORKING
    user_data = {
        "userId": user_id,
        "email": email.strip().lower(),
        "fullName": full_name,
        "photo": "/static/images/default-avatar.svg",
        "passwordHash": password_hash,
        "createdAt": datetime.datetime.now().isoformat()
    }
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            db_client.collection('users').document(user_id).set(user_data)
            _user_info_cache[user_id] = user_data
            return user_data
        except Exception as e:
            logger.warning(f"Firebase create_local_user error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    db["users"][user_id] = user_data
    _save_local_db(db)
    _user_info_cache[user_id] = user_data
    return user_data


# ==========================================
# CONTACTS CRUD OPERATIONS (FIRESTORE / LOCAL)
# ==========================================
def get_contacts(user_id):
    global FIRESTORE_WORKING
    cache = _get_user_cache(user_id)
    if cache['contacts'] is not None:
        return cache['contacts']
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
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
            logger.warning(f"Firebase get_contacts error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    contacts_list = []
    for cid, cdata in db["contacts"].items():
        if cdata.get('userId') == user_id:
            contacts_list.append(cdata)
    cache['contacts'] = contacts_list
    return contacts_list

def get_contact(user_id, contact_id):
    global FIRESTORE_WORKING
    cache = _get_user_cache(user_id)
    if cache['contacts'] is not None:
        for c in cache['contacts']:
            if c.get('contactId') == contact_id:
                return c
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc = db_client.collection('contacts').document(contact_id).get()
            if doc.exists:
                data = doc.to_dict()
                if data.get('userId') == user_id:
                    data['contactId'] = doc.id
                    return data
        except Exception as e:
            logger.warning(f"Firebase get_contact error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    cdata = db["contacts"].get(contact_id)
    if cdata and cdata.get('userId') == user_id:
        return cdata
    return None

def create_contact(user_id, contact_data):
    global FIRESTORE_WORKING
    contact_id = uuid.uuid4().hex
    contact_data['contactId'] = contact_id
    contact_data['userId'] = user_id
    contact_data['createdDate'] = datetime.datetime.now().isoformat()
    contact_data['favorite'] = bool(contact_data.get('favorite', False))
    contact_data['emergency'] = bool(contact_data.get('emergency', False))
    if 'photo' not in contact_data:
        contact_data['photo'] = None
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            db_client.collection('contacts').document(contact_id).set(contact_data)
            clear_user_cache(user_id, 'contacts')
            return contact_data
        except Exception as e:
            logger.warning(f"Firebase create_contact error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    db["contacts"][contact_id] = contact_data
    _save_local_db(db)
    clear_user_cache(user_id, 'contacts')
    return contact_data

def update_contact(user_id, contact_id, contact_data):
    global FIRESTORE_WORKING
    contact_data['contactId'] = contact_id
    contact_data['userId'] = user_id
    contact_data['favorite'] = bool(contact_data.get('favorite', False))
    contact_data['emergency'] = bool(contact_data.get('emergency', False))
    
    # Check cache first for existing contact details to save a Firestore read
    cache = _get_user_cache(user_id)
    existing_data = None
    if cache['contacts'] is not None:
        for c in cache['contacts']:
            if c.get('contactId') == contact_id:
                existing_data = c
                break
    
    if not existing_data:
        if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
            try:
                doc_ref = db_client.collection('contacts').document(contact_id)
                existing = doc_ref.get()
                if existing.exists:
                    existing_data = existing.to_dict()
            except Exception as e:
                logger.warning(f"Firebase get existing contact error: {e}. Falling back to local database.")
                FIRESTORE_WORKING = False
        # Local get if Firestore failed or not working
        if not existing_data:
            db = _load_local_db()
            existing_data = db["contacts"].get(contact_id)

    if existing_data and existing_data.get('userId') == user_id:
        contact_data['createdDate'] = existing_data.get('createdDate', datetime.datetime.now().isoformat())
        if not contact_data.get('photo'):
            contact_data['photo'] = existing_data.get('photo')
            
        if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
            try:
                db_client.collection('contacts').document(contact_id).set(contact_data, merge=True)
                clear_user_cache(user_id, 'contacts')
                return contact_data
            except Exception as e:
                logger.warning(f"Firebase update_contact error: {e}. Falling back to local database.")
                FIRESTORE_WORKING = False
                
        # Local fallback
        db = _load_local_db()
        db["contacts"][contact_id] = contact_data
        _save_local_db(db)
        clear_user_cache(user_id, 'contacts')
        return contact_data
    return None

def delete_contact(user_id, contact_id):
    global FIRESTORE_WORKING
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc_ref = db_client.collection('contacts').document(contact_id)
            doc_ref.delete()
            clear_user_cache(user_id, 'contacts')
            return True
        except Exception as e:
            logger.warning(f"Firebase delete_contact error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    if contact_id in db["contacts"]:
        del db["contacts"][contact_id]
        _save_local_db(db)
        clear_user_cache(user_id, 'contacts')
        return True
    return False


# ==========================================
# GROUPS OPERATIONS (FIRESTORE / LOCAL)
# ==========================================
def get_groups(user_id):
    global FIRESTORE_WORKING
    cache = _get_user_cache(user_id)
    if cache['groups'] is not None:
        return cache['groups']
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
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
            logger.warning(f"Firebase get_groups error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    groups_list = []
    for gid, gdata in db["groups"].items():
        if gdata.get('userId') == user_id:
            groups_list.append(gdata)
    cache['groups'] = groups_list
    return groups_list

def create_group(user_id, group_name, description=""):
    global FIRESTORE_WORKING
    group_id = uuid.uuid4().hex
    group_data = {
        "groupId": group_id,
        "userId": user_id,
        "groupName": group_name,
        "description": description,
        "contacts": []
    }
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            db_client.collection('groups').document(group_id).set(group_data)
            clear_user_cache(user_id, 'groups')
            return group_data
        except Exception as e:
            logger.warning(f"Firebase create_group error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    db["groups"][group_id] = group_data
    _save_local_db(db)
    clear_user_cache(user_id, 'groups')
    return group_data

def update_group(user_id, group_id, group_name, description, contact_ids=None):
    global FIRESTORE_WORKING
    existing_group = None
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc_ref = db_client.collection('groups').document(group_id)
            doc = doc_ref.get()
            if doc.exists:
                existing_group = doc.to_dict()
        except Exception as e:
            logger.warning(f"Firebase get_group error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
            
    if not existing_group:
        db = _load_local_db()
        existing_group = db["groups"].get(group_id)
        
    if existing_group and existing_group.get('userId') == user_id:
        update_data = {
            "groupName": group_name,
            "description": description
        }
        if contact_ids is not None:
            update_data["contacts"] = contact_ids
            
        if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
            try:
                db_client.collection('groups').document(group_id).update(update_data)
                clear_user_cache(user_id, 'groups')
                return True
            except Exception as e:
                logger.warning(f"Firebase update_group error: {e}. Falling back to local database.")
                FIRESTORE_WORKING = False
                
        # Local fallback
        db = _load_local_db()
        if group_id in db["groups"]:
            db["groups"][group_id].update(update_data)
            _save_local_db(db)
            clear_user_cache(user_id, 'groups')
            return True
    return False

def delete_group(user_id, group_id):
    global FIRESTORE_WORKING
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc_ref = db_client.collection('groups').document(group_id)
            doc_ref.delete()
            clear_user_cache(user_id, 'groups')
            return True
        except Exception as e:
            logger.warning(f"Firebase delete_group error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    if group_id in db["groups"]:
        del db["groups"][group_id]
        _save_local_db(db)
        clear_user_cache(user_id, 'groups')
        return True
    return False


# ==========================================
# NOTIFICATIONS OPERATIONS (FIRESTORE / LOCAL)
# ==========================================
def get_notifications(user_id):
    global FIRESTORE_WORKING
    cache = _get_user_cache(user_id)
    if cache['notifications'] is not None:
        return cache['notifications']
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
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
            logger.warning(f"Firebase get_notifications error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    notifications_list = []
    for nid, ndata in db["notifications"].items():
        if ndata.get('userId') == user_id:
            notifications_list.append(ndata)
    notifications_list.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
    cache['notifications'] = notifications_list
    return notifications_list

def create_notification(user_id, notif_type, message):
    global FIRESTORE_WORKING
    notification_id = uuid.uuid4().hex
    notif_data = {
        "notificationId": notification_id,
        "userId": user_id,
        "type": notif_type,
        "message": message,
        "read": False,
        "createdAt": datetime.datetime.now().isoformat()
    }
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            db_client.collection('notifications').document(notification_id).set(notif_data)
            clear_user_cache(user_id, 'notifications')
            return notif_data
        except Exception as e:
            logger.warning(f"Firebase create_notification error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    db["notifications"][notification_id] = notif_data
    _save_local_db(db)
    clear_user_cache(user_id, 'notifications')
    return notif_data

def mark_notifications_read(user_id):
    global FIRESTORE_WORKING
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
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
            logger.warning(f"Firebase mark_notifications_read error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    updated = False
    for nid, ndata in db["notifications"].items():
        if ndata.get('userId') == user_id and not ndata.get('read', False):
            db["notifications"][nid]["read"] = True
            updated = True
    if updated:
        _save_local_db(db)
        clear_user_cache(user_id, 'notifications')
    return True


# ==========================================
# CATEGORIES OPERATIONS (FIRESTORE / LOCAL)
# ==========================================
DEFAULT_CATEGORIES = ["Family", "Friends", "Work", "Clients", "Business", "Personal", "Emergency"]

def get_categories(user_id):
    global FIRESTORE_WORKING
    cache = _get_user_cache(user_id)
    if cache['categories'] is not None:
        return cache['categories']
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            doc = db_client.collection('categories').document(user_id).get()
            if doc.exists:
                cats = doc.to_dict().get('categories', DEFAULT_CATEGORIES)
                cache['categories'] = cats
                return cats
        except Exception as e:
            logger.warning(f"Firebase get_categories error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    cats = db["categories"].get(user_id)
    if cats:
        cache['categories'] = cats
        return cats
    cache['categories'] = DEFAULT_CATEGORIES
    return DEFAULT_CATEGORIES

def add_category(user_id, category_name):
    global FIRESTORE_WORKING
    category_name = category_name.strip()
    if not category_name:
        return None
        
    current = get_categories(user_id)
    if category_name in current:
        return current
        
    current.append(category_name)
    if FIREBASE_ENABLED and db_client and FIRESTORE_WORKING:
        try:
            db_client.collection('categories').document(user_id).set({"categories": current})
            clear_user_cache(user_id, 'categories')
            return current
        except Exception as e:
            logger.warning(f"Firebase add_category error: {e}. Falling back to local database.")
            FIRESTORE_WORKING = False
    # Local fallback
    db = _load_local_db()
    db["categories"][user_id] = current
    _save_local_db(db)
    clear_user_cache(user_id, 'categories')
    return current
