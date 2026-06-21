import os
import csv
import io
import datetime
import logging
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from firebase_config import FIREBASE_ENABLED
import database

# Firebase is client-enabled only if Firebase backend is enabled and client keys (e.g. API Key) are configured
CLIENT_FIREBASE_ENABLED = FIREBASE_ENABLED and bool(os.environ.get("FIREBASE_API_KEY"))

# ReportLab imports for PDF Generation
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# Initialize Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "supersecretkey_contactsystem123")



# Helper: Login required decorator
def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            # If AJAX request, return unauthorized JSON
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

@app.before_request
def load_user_to_session():
    if 'user_id' in session:
        if 'name' not in session or 'photo' not in session or 'email' not in session:
            try:
                user = database.get_user(session['user_id'])
                if user:
                    session['name'] = user.get('fullName', '')
                    session['email'] = user.get('email', '')
                    session['photo'] = user.get('photo', '/static/images/default-avatar.svg')
            except Exception as e:
                logger.error(f"Error loading user to session: {e}")

@app.context_processor
def inject_user():
    if 'user_id' in session:
        return {
            'user': {
                'fullName': session.get('name', ''),
                'email': session.get('email', ''),
                'photo': session.get('photo', '/static/images/default-avatar.svg')
            }
        }
    return {'user': None}

# ==========================================
# PAGE ROUTING
# ==========================================
@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))
    return render_template('login.html', firebase_enabled=CLIENT_FIREBASE_ENABLED)

@app.route('/register')
def register_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))
    return render_template('register.html', firebase_enabled=CLIENT_FIREBASE_ENABLED)

@app.route('/')
@login_required
def index():
    return redirect(url_for('dashboard_page'))

@app.route('/dashboard')
@login_required
def dashboard_page():
    return render_template('dashboard.html', active_page='dashboard', firebase_enabled=CLIENT_FIREBASE_ENABLED)

@app.route('/contacts')
@login_required
def contacts_page():
    return render_template('contacts.html', active_page='contacts', firebase_enabled=CLIENT_FIREBASE_ENABLED)

@app.route('/groups')
@login_required
def groups_page():
    return render_template('groups.html', active_page='groups', firebase_enabled=CLIENT_FIREBASE_ENABLED)



@app.route('/profile')
@login_required
def profile_page():
    return render_template('profile.html', active_page='profile', firebase_enabled=CLIENT_FIREBASE_ENABLED)


# ==========================================
# AUTHENTICATION API ENDPOINTS
# ==========================================
@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    id_token = data.get('idToken')
    if not id_token:
        return jsonify({"error": "Missing Firebase ID Token"}), 400
    try:
        from firebase_admin import auth
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', '')
        name = decoded_token.get('name', email.split('@')[0])
        picture = decoded_token.get('picture', '')
        
        # Sync profile to database, but DO NOT set session cookies
        user_data = database.create_or_update_user(uid, email, name, photo_url=picture)
        
        # Log notification
        database.create_notification(uid, "System", f"Welcome to Contact Management System, {name}!")
        
        return jsonify({"success": True, "user": user_data})
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    id_token = data.get('idToken')
    if not id_token:
        return jsonify({"error": "Missing Firebase ID Token"}), 400
    try:
        from firebase_admin import auth
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', '')
        name = decoded_token.get('name', email.split('@')[0])
        picture = decoded_token.get('picture', '')
        
        # Sync to local-aware users db
        user_data = database.create_or_update_user(uid, email, name, photo_url=picture)
        
        session['user_id'] = uid
        session['email'] = email
        session['name'] = name
        session['photo'] = user_data.get('photo', '/static/images/default-avatar.svg')
        
        return jsonify({"success": True, "user": user_data})
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/auth/register-local', methods=['POST'])
def api_register_local():
    import uuid
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    full_name = data.get('fullName', '').strip()
    
    if not email or not password or not full_name:
        return jsonify({"error": "Missing required fields"}), 400
        
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
        
    try:
        # Check if user already exists
        existing_user = database.get_user_by_email(email)
        if existing_user:
            if not existing_user.get('passwordHash'):
                # Convert Firebase-registered user to local user by setting passwordHash
                password_hash = generate_password_hash(password)
                user_data = database.create_or_update_user(
                    existing_user['userId'], 
                    email, 
                    full_name or existing_user.get('fullName'), 
                    photo_url=existing_user.get('photo'), 
                    password_hash=password_hash
                )
                database.create_notification(existing_user['userId'], "System", f"Welcome back, {full_name}! Account upgraded to local sign-in.")
                return jsonify({"success": True, "user": user_data})
            return jsonify({"error": "An account with this email address already exists."}), 400
            
        # Create user with password hash
        uid = uuid.uuid4().hex
        password_hash = generate_password_hash(password)
        user_data = database.create_local_user(uid, email, full_name, password_hash)
        
        # Log notification
        database.create_notification(uid, "System", f"Welcome to Contact Management System, {full_name}!")
        
        return jsonify({"success": True, "user": user_data})
    except Exception as e:
        logger.error(f"Local registration error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/auth/login-local', methods=['POST'])
def api_login_local():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({"error": "Missing email or password"}), 400
        
    try:
        user_data = database.get_user_by_email(email)
        if not user_data:
            return jsonify({"error": "Invalid email or password"}), 401
            
        password_hash = user_data.get('passwordHash')
        if not password_hash:
            return jsonify({"error": "This account is registered via Firebase. Please sign in using standard Firebase Auth."}), 400
            
        if not check_password_hash(password_hash, password):
            return jsonify({"error": "Invalid email or password"}), 401
            
        session['user_id'] = user_data['userId']
        session['email'] = user_data['email']
        session['name'] = user_data['fullName']
        session['photo'] = user_data.get('photo', '/static/images/default-avatar.svg')
        
        return jsonify({"success": True, "user": user_data})
    except Exception as e:
        logger.error(f"Local login error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/auth/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    is_local = data.get('isLocal', False)
    if is_local:
        return jsonify({"success": True, "message": f"Password reset instructions for {email} have been simulated."})
    return jsonify({"info": "Forgot password flow is managed client-side using Firebase SDK."})


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))


# ==========================================
# CONTACT MANAGEMENT API ENDPOINTS
# ==========================================
@app.route('/api/contacts', methods=['GET'])
@login_required
def api_get_contacts():
    user_id = session['user_id']
    contacts = database.get_contacts(user_id)
    return jsonify(contacts)

@app.route('/api/contacts', methods=['POST'])
@login_required
def api_create_contact():
    user_id = session['user_id']
    
    # Check if multipart form (contains photo upload) or JSON
    if request.content_type and 'multipart/form-data' in request.content_type:
        contact_data = request.form.to_dict()
        photo_file = request.files.get('photo')
        if photo_file:
            photo_url = database.save_file(photo_file, photo_file.filename, 'contacts')
            contact_data['photo'] = photo_url
    else:
        contact_data = request.get_json() or {}
        
    # Validations
    if not contact_data.get('firstName') or not contact_data.get('mobile'):
        return jsonify({"error": "First Name and Mobile Number are required"}), 400

    # Ensure boolean mapping
    contact_data['favorite'] = contact_data.get('favorite') == 'true' or contact_data.get('favorite') is True
    contact_data['emergency'] = contact_data.get('emergency') == 'true' or contact_data.get('emergency') is True

    new_contact = database.create_contact(user_id, contact_data)
    
    # Log recent activity notification in background thread to avoid blocking response
    import threading
    threading.Thread(target=database.create_notification, args=(user_id, "Contact", f"Added contact: {new_contact['firstName']} {new_contact.get('lastName', '')}")).start()

    return jsonify(new_contact), 201

@app.route('/api/contacts/<contact_id>', methods=['GET'])
@login_required
def api_get_contact_detail(contact_id):
    user_id = session['user_id']
    contact = database.get_contact(user_id, contact_id)
    if not contact:
        return jsonify({"error": "Contact not found"}), 404
    return jsonify(contact)

@app.route('/api/contacts/<contact_id>', methods=['POST', 'PUT'])
@login_required
def api_update_contact(contact_id):
    user_id = session['user_id']
    contact = database.get_contact(user_id, contact_id)
    if not contact:
        return jsonify({"error": "Contact not found"}), 404

    if request.content_type and 'multipart/form-data' in request.content_type:
        contact_data = request.form.to_dict()
        photo_file = request.files.get('photo')
        if photo_file:
            photo_url = database.save_file(photo_file, photo_file.filename, 'contacts')
            contact_data['photo'] = photo_url
    else:
        contact_data = request.get_json() or {}

    # Ensure required fields
    if not contact_data.get('firstName') or not contact_data.get('mobile'):
        return jsonify({"error": "First Name and Mobile Number are required"}), 400

    # Ensure boolean mapping
    contact_data['favorite'] = contact_data.get('favorite') == 'true' or contact_data.get('favorite') is True
    contact_data['emergency'] = contact_data.get('emergency') == 'true' or contact_data.get('emergency') is True

    updated_contact = database.update_contact(user_id, contact_id, contact_data)
    
    if not updated_contact:
        return jsonify({"error": "Could not update contact"}), 500
        
    return jsonify(updated_contact)

@app.route('/api/contacts/<contact_id>', methods=['DELETE'])
@login_required
def api_delete_contact(contact_id):
    user_id = session['user_id']
    contact = database.get_contact(user_id, contact_id)
    if not contact:
        return jsonify({"error": "Contact not found"}), 404
        
    success = database.delete_contact(user_id, contact_id)
    if success:
        # Also clean up groups referencing this contact if needed in background thread
        import threading
        threading.Thread(target=database.create_notification, args=(user_id, "Contact", f"Deleted contact: {contact['firstName']} {contact.get('lastName', '')}")).start()
        return jsonify({"success": True})
    return jsonify({"error": "Could not delete contact"}), 500


# ==========================================
# GROUP MANAGEMENT API ENDPOINTS
# ==========================================
@app.route('/api/groups', methods=['GET'])
@login_required
def api_get_groups():
    user_id = session['user_id']
    groups = database.get_groups(user_id)
    return jsonify(groups)

@app.route('/api/groups', methods=['POST'])
@login_required
def api_create_group():
    user_id = session['user_id']
    data = request.get_json() or {}
    group_name = data.get('groupName', '').strip()
    description = data.get('description', '').strip()
    
    if not group_name:
        return jsonify({"error": "Group name is required"}), 400
        
    new_group = database.create_group(user_id, group_name, description)
    return jsonify(new_group), 201

@app.route('/api/groups/<group_id>', methods=['PUT'])
@login_required
def api_update_group(group_id):
    user_id = session['user_id']
    data = request.get_json() or {}
    group_name = data.get('groupName', '').strip()
    description = data.get('description', '').strip()
    contact_ids = data.get('contacts') # Expected list of contact IDs
    
    if not group_name:
        return jsonify({"error": "Group name is required"}), 400
        
    success = database.update_group(user_id, group_id, group_name, description, contact_ids)
    if success:
        return jsonify({"success": True})
    return jsonify({"error": "Group not found or unauthorized"}), 404

@app.route('/api/groups/<group_id>', methods=['DELETE'])
@login_required
def api_delete_group(group_id):
    user_id = session['user_id']
    success = database.delete_group(user_id, group_id)
    if success:
        return jsonify({"success": True})
    return jsonify({"error": "Group not found or unauthorized"}), 404


# ==========================================
# NOTIFICATIONS & CATEGORIES ENDPOINTS
# ==========================================
@app.route('/api/notifications', methods=['GET'])
@login_required
def api_get_notifications():
    user_id = session['user_id']
    notifs = database.get_notifications(user_id)
    return jsonify(notifs)

@app.route('/api/notifications/read', methods=['POST'])
@login_required
def api_mark_notifications_read():
    user_id = session['user_id']
    database.mark_notifications_read(user_id)
    return jsonify({"success": True})

@app.route('/api/categories', methods=['GET'])
@login_required
def api_get_categories():
    user_id = session['user_id']
    cats = database.get_categories(user_id)
    return jsonify(cats)

@app.route('/api/categories', methods=['POST'])
@login_required
def api_add_category():
    user_id = session['user_id']
    data = request.get_json() or {}
    category_name = data.get('categoryName', '').strip()
    
    if not category_name:
        return jsonify({"error": "Category name is required"}), 400
        
    updated_cats = database.add_category(user_id, category_name)
    if updated_cats:
        return jsonify(updated_cats)
    return jsonify({"error": "Could not add category"}), 400


# ==========================================
# PROFILE & SETTINGS ENDPOINTS
# ==========================================
@app.route('/api/profile/update', methods=['POST'])
@login_required
def api_update_profile():
    user_id = session['user_id']
    
    # Process multi-part form
    full_name = request.form.get('fullName', '').strip()
    email = request.form.get('email', '').strip().lower()
    password = request.form.get('password', '')
    
    if not full_name or not email:
        return jsonify({"error": "Name and Email are required"}), 400
        
    # Handle Photo upload if present
    photo_url = None
    photo_file = request.files.get('photo')
    if photo_file:
        photo_url = database.save_file(photo_file, photo_file.filename, 'profiles')
        
    # Check if local user (has passwordHash) or Firebase is disabled
    existing_user = database.get_user(user_id)
    is_local = existing_user and ('passwordHash' in existing_user)

    password_hash = None
    if password and (is_local or not FIREBASE_ENABLED):
        password_hash = generate_password_hash(password)

    # Save base info
    user_data = database.create_or_update_user(user_id, email, full_name, photo_url=photo_url, password_hash=password_hash)
    session['name'] = full_name
    session['email'] = email
    session['photo'] = user_data.get('photo', '/static/images/default-avatar.svg')
    
    # Handle password update for Firebase users
    if password and not is_local and FIREBASE_ENABLED:
        try:
            from firebase_admin import auth
            auth.update_user(user_id, password=password)
        except Exception as e:
            logger.error(f"Firebase password update failed: {e}")
            return jsonify({"error": f"Failed updating password: {e}"}), 400
    import threading
    threading.Thread(target=database.create_notification, args=(user_id, "System", "Your profile details have been updated successfully.")).start()
    return jsonify({"success": True, "user": user_data})


# ==========================================
# ANALYTICS DASHBOARD STATS
# ==========================================
@app.route('/api/dashboard/stats', methods=['GET'])
@login_required
def api_dashboard_stats():
    user_id = session['user_id']
    
    contacts = database.get_contacts(user_id)
    
    total_contacts = len(contacts)
    favorites = sum(1 for c in contacts if c.get('favorite'))
    emergency = sum(1 for c in contacts if c.get('emergency'))
    
    # Upcoming birthdays in the next 30 days
    upcoming_birthdays = []
    today = datetime.date.today()
    birthday_count = 0
    
    # Categories counts
    category_counts = {}
    for cat in database.get_categories(user_id):
        category_counts[cat] = 0
        
    for c in contacts:
        cat = c.get('category', 'Personal')
        category_counts[cat] = category_counts.get(cat, 0) + 1
        
        # Check birthday
        bday_str = c.get('birthday')
        if bday_str:
            try:
                bday = datetime.datetime.strptime(bday_str, "%Y-%m-%d").date()
                # Check if birthday falls in current or next month
                bday_this_year = datetime.date(today.year, bday.month, bday.day)
                bday_next_year = datetime.date(today.year + 1, bday.month, bday.day)
                
                # Check which one is closest upcoming
                closest_bday = bday_this_year if bday_this_year >= today else bday_next_year
                days_until = (closest_bday - today).days
                
                if days_until <= 30:
                    birthday_count += 1
                    upcoming_birthdays.append({
                        "name": f"{c['firstName']} {c.get('lastName', '')}",
                        "date": bday_str,
                        "daysLeft": days_until,
                        "photo": c.get('photo')
                    })
            except Exception:
                pass
                
    # Sort upcoming birthdays by closest daysLeft
    upcoming_birthdays.sort(key=lambda x: x['daysLeft'])
    
    # Recent Activities (Simulated using contact creation dates)
    activities = []
    sorted_contacts = sorted(contacts, key=lambda x: x.get('createdDate', ''), reverse=True)
    for c in sorted_contacts[:5]:
        activities.append({
            "type": "contact_added",
            "message": f"Added contact '{c['firstName']} {c.get('lastName', '')}'",
            "timestamp": c.get('createdDate', '')
        })
        

        
    activities.sort(key=lambda x: x['timestamp'], reverse=True)
    
    # Growth monthly data (simulation based on created dates of contacts)
    # Get last 6 months list
    monthly_growth = {}
    for i in range(5, -1, -1):
        target_date = today - datetime.timedelta(days=i*30)
        month_name = target_date.strftime("%b")
        monthly_growth[month_name] = 0
        
    for c in contacts:
        created_str = c.get('createdDate')
        if created_str:
            try:
                created_date = datetime.datetime.fromisoformat(created_str).date()
                month_name = created_date.strftime("%b")
                if month_name in monthly_growth:
                    monthly_growth[month_name] += 1
            except Exception:
                pass
                
    # Cumulative monthly calculations
    monthly_chart_data = {
        "labels": list(monthly_growth.keys()),
        "data": list(monthly_growth.values())
    }



    return jsonify({
        "summary": {
            "totalContacts": total_contacts,
            "favorites": favorites,
            "emergency": emergency,
            "upcomingBirthdaysCount": birthday_count
        },
        "recentContacts": sorted_contacts[:5],
        "recentActivities": activities[:5],
        "birthdayCalendar": upcoming_birthdays,
        "categoryDistribution": category_counts,
        "monthlyGrowth": monthly_chart_data
    })


# ==========================================
# IMPORT & EXPORT MODULE (CSV / PDF)
# ==========================================
@app.route('/api/contacts/export-csv', methods=['GET'])
@login_required
def api_export_csv():
    user_id = session['user_id']
    contacts = database.get_contacts(user_id)
    
    # Generate CSV in memory
    si = io.StringIO()
    cw = csv.writer(si)
    
    # Write CSV Header
    headers = [
        "First Name", "Last Name", "Mobile", "Alternate Mobile", "Email", 
        "Address", "Company", "Designation", "Website", "Birthday", 
        "Category", "Favorite (True/False)", "Emergency (True/False)", "Notes"
    ]
    cw.writerow(headers)
    
    for c in contacts:
        cw.writerow([
            c.get("firstName", ""),
            c.get("lastName", ""),
            c.get("mobile", ""),
            c.get("alternateNumber", ""),
            c.get("email", ""),
            c.get("address", ""),
            c.get("company", ""),
            c.get("designation", ""),
            c.get("website", ""),
            c.get("birthday", ""),
            c.get("category", "Personal"),
            str(c.get("favorite", False)),
            str(c.get("emergency", False)),
            c.get("notes", "")
        ])
        
    output = io.BytesIO()
    output.write(si.getvalue().encode('utf-8'))
    output.seek(0)
    
    return send_file(
        output,
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"contacts_export_{datetime.date.today().isoformat()}.csv"
    )

@app.route('/api/contacts/import-csv', methods=['POST'])
@login_required
def api_import_csv():
    user_id = session['user_id']
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    if not file.filename.endswith('.csv'):
        return jsonify({"error": "Only CSV files are allowed"}), 400
        
    try:
        stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_reader = csv.reader(stream)
        
        # Read header
        header = next(csv_reader, None)
        if not header:
            return jsonify({"error": "CSV is empty"}), 400
            
        imported_count = 0
        skipped_count = 0
        errors = []
        
        existing_contacts = database.get_contacts(user_id)
        existing_mobiles = {c.get('mobile') for c in existing_contacts if c.get('mobile')}
        
        for index, row in enumerate(csv_reader, start=1):
            if not row or len(row) < 3: # Need at least firstName and mobile
                skipped_count += 1
                errors.append(f"Row {index}: Insufficient columns.")
                continue
                
            first_name = row[0].strip()
            mobile = row[2].strip()
            
            if not first_name or not mobile:
                skipped_count += 1
                errors.append(f"Row {index}: Missing required Name or Mobile fields.")
                continue
                
            # Duplicate validation check
            if mobile in existing_mobiles:
                skipped_count += 1
                errors.append(f"Row {index}: Contact with mobile '{mobile}' already exists.")
                continue
                
            # Safely get other indices
            last_name = row[1].strip() if len(row) > 1 else ""
            alt_mobile = row[3].strip() if len(row) > 3 else ""
            email = row[4].strip() if len(row) > 4 else ""
            address = row[5].strip() if len(row) > 5 else ""
            company = row[6].strip() if len(row) > 6 else ""
            designation = row[7].strip() if len(row) > 7 else ""
            website = row[8].strip() if len(row) > 8 else ""
            birthday = row[9].strip() if len(row) > 9 else ""
            category = row[10].strip() if len(row) > 10 else "Personal"
            favorite = row[11].strip().lower() == 'true' if len(row) > 11 else False
            emergency = row[12].strip().lower() == 'true' if len(row) > 12 else False
            notes = row[13].strip() if len(row) > 13 else ""
            
            contact_data = {
                "firstName": first_name,
                "lastName": last_name,
                "mobile": mobile,
                "alternateNumber": alt_mobile,
                "email": email,
                "address": address,
                "company": company,
                "designation": designation,
                "website": website,
                "birthday": birthday,
                "category": category,
                "favorite": favorite,
                "emergency": emergency,
                "notes": notes
            }
            
            database.create_contact(user_id, contact_data)
            existing_mobiles.add(mobile)
            imported_count += 1
            
        database.create_notification(user_id, "System", f"Bulk CSV Import complete. Imported: {imported_count}, Skipped: {skipped_count}")
        return jsonify({
            "success": True,
            "imported": imported_count,
            "skipped": skipped_count,
            "errors": errors
        })
        
    except Exception as e:
        logger.error(f"CSV Import error: {e}")
        return jsonify({"error": f"Failed to parse CSV: {str(e)}"}), 500

@app.route('/api/contacts/export-pdf', methods=['GET'])
@login_required
def api_export_pdf():
    user_id = session['user_id']
    contact_id = request.args.get('contactId')
    
    # Create memory file for output
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    # Custom colors
    primary_color = colors.HexColor("#2563EB")
    secondary_color = colors.HexColor("#1E293B")
    grey_color = colors.HexColor("#64748B")
    line_color = colors.HexColor("#E2E8F0")
    
    # Custom styles
    title_style = ParagraphStyle(
        name='TitleStyle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=24,
        textColor=primary_color,
        spaceAfter=15
    )
    subtitle_style = ParagraphStyle(
        name='SubTitleStyle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        textColor=grey_color,
        spaceAfter=25
    )
    section_heading = ParagraphStyle(
        name='SecHeading',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        textColor=secondary_color,
        spaceAfter=10,
        spaceBefore=10
    )
    cell_style = ParagraphStyle(
        name='Cell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        textColor=secondary_color
    )
    header_cell_style = ParagraphStyle(
        name='HeaderCell',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        textColor=colors.white
    )
    
    story = []
    
    if contact_id:
        # Export single contact details
        c = database.get_contact(user_id, contact_id)
        if not c:
            return "Contact not found", 404
            
        story.append(Paragraph(f"Contact Profile: {c.get('firstName')} {c.get('lastName', '')}", title_style))
        story.append(Paragraph(f"Generated on {datetime.date.today().strftime('%B %d, %Y')}", subtitle_style))
        
        # Details grid table
        data = [
            [Paragraph("<b>Field</b>", cell_style), Paragraph("<b>Details</b>", cell_style)],
            [Paragraph("Name", cell_style), Paragraph(f"{c.get('firstName')} {c.get('lastName', '')}", cell_style)],
            [Paragraph("Mobile Number", cell_style), Paragraph(c.get('mobile', '-'), cell_style)],
            [Paragraph("Alternate Number", cell_style), Paragraph(c.get('alternateNumber', '-'), cell_style)],
            [Paragraph("Email Address", cell_style), Paragraph(c.get('email', '-'), cell_style)],
            [Paragraph("Category", cell_style), Paragraph(c.get('category', 'Personal'), cell_style)],
            [Paragraph("Company", cell_style), Paragraph(c.get('company', '-'), cell_style)],
            [Paragraph("Designation", cell_style), Paragraph(c.get('designation', '-'), cell_style)],
            [Paragraph("Website", cell_style), Paragraph(c.get('website', '-'), cell_style)],
            [Paragraph("Address", cell_style), Paragraph(c.get('address', '-'), cell_style)],
            [Paragraph("Birthday", cell_style), Paragraph(c.get('birthday', '-'), cell_style)],
            [Paragraph("Favorites Status", cell_style), Paragraph("Favorite Contact ⭐" if c.get('favorite') else "Standard", cell_style)],
            [Paragraph("Emergency Status", cell_style), Paragraph("EMERGENCY CONTACT 🚨" if c.get('emergency') else "No", cell_style)],
            [Paragraph("Notes", cell_style), Paragraph(c.get('notes', '-'), cell_style)]
        ]
        
        t = Table(data, colWidths=[150, 350])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#F1F5F9")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('GRID', (0,0), (-1,-1), 0.5, line_color),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        
        story.append(t)
    else:
        # Export all contacts listing directory
        contacts = database.get_contacts(user_id)
        
        story.append(Paragraph("Contact Directory", title_style))
        story.append(Paragraph(f"Total Records: {len(contacts)} | Generated on {datetime.date.today().strftime('%B %d, %Y')}", subtitle_style))
        
        # Build Table rows
        data = [[
            Paragraph("Name", header_cell_style), 
            Paragraph("Mobile", header_cell_style), 
            Paragraph("Email", header_cell_style), 
            Paragraph("Category", header_cell_style), 
            Paragraph("Company", header_cell_style)
        ]]
        
        for c in contacts:
            data.append([
                Paragraph(f"<b>{c.get('firstName')} {c.get('lastName','')}</b>" + (" ⭐" if c.get('favorite') else "") + (" 🚨" if c.get('emergency') else ""), cell_style),
                Paragraph(c.get('mobile','-'), cell_style),
                Paragraph(c.get('email','-'), cell_style),
                Paragraph(c.get('category','Personal'), cell_style),
                Paragraph(c.get('company','-'), cell_style)
            ])
            
        t = Table(data, colWidths=[130, 100, 130, 80, 100])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), primary_color),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]),
            ('GRID', (0,0), (-1,-1), 0.5, line_color),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(t)
        
    doc.build(story)
    buffer.seek(0)
    
    filename = f"contact_details_{contact_id}.pdf" if contact_id else f"contacts_directory_{datetime.date.today().isoformat()}.pdf"
    
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename
    )


@app.route('/api/config', methods=['GET'])
def api_get_config():
    return jsonify({
        "firebaseEnabled": FIREBASE_ENABLED,
        "config": {
            "apiKey": os.environ.get("FIREBASE_API_KEY", ""),
            "authDomain": os.environ.get("FIREBASE_AUTH_DOMAIN", ""),
            "projectId": os.environ.get("FIREBASE_PROJECT_ID", ""),
            "storageBucket": os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
            "messagingSenderId": os.environ.get("FIREBASE_MESSAGING_SENDER_ID", ""),
            "appId": os.environ.get("FIREBASE_APP_ID", "")
        }
    })

if __name__ == '__main__':
    # Run development server
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
