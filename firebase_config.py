import os
import logging
import firebase_admin
from firebase_admin import credentials
from dotenv import load_dotenv

load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FIREBASE_ENABLED = False
db_client = None
storage_bucket = None
cred = None

# Check for service account key file in root
SERVICE_ACCOUNT_KEY_PATH = os.path.join(os.path.dirname(__file__), 'serviceAccountKey.json')

# Alternatively check environment variable
firebase_key_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")

try:
    if os.path.exists(SERVICE_ACCOUNT_KEY_PATH) or firebase_key_env:
        if os.path.exists(SERVICE_ACCOUNT_KEY_PATH):
            cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
            logger.info("Initializing Firebase using serviceAccountKey.json")
        else:
            # We can write the environment variable string to a temp file and load it
            import tempfile
            import json
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
            temp_file.write(firebase_key_env.encode('utf-8'))
            temp_file.close()
            cred = credentials.Certificate(temp_file.name)
            logger.info("Initializing Firebase using Environment Variable Certificate")
            
        # Get storage bucket name from env or default
        bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET")
        
        # Initialize firebase admin
        if not firebase_admin._apps:
            if bucket_name:
                firebase_admin.initialize_app(cred, {
                    'storageBucket': bucket_name
                })
            else:
                firebase_admin.initialize_app(cred)
        
        from firebase_admin import firestore, storage
        db_client = firestore.client()
        
        # Try getting storage bucket
        try:
            storage_bucket = storage.bucket()
        except Exception as e:
            logger.warning(f"Could not initialize Firebase Storage: {e}. Photo uploads will be simulated.")
            storage_bucket = None
            
        FIREBASE_ENABLED = True
        logger.info("Firebase services successfully initialized.")
    else:
        logger.warning(
            "Firebase Configuration Error: 'serviceAccountKey.json' not found in root, and FIREBASE_SERVICE_ACCOUNT_JSON env var is missing. "
            "Firebase is disabled. Local JSON database fallback mode will be active."
        )
        FIREBASE_ENABLED = False
except Exception as e:
    logger.error(
        f"Firebase Initialization Error: {e}. "
        "Firebase is disabled. Local JSON database fallback mode will be active."
    )
    FIREBASE_ENABLED = False

