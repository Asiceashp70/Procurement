# UI/UX Wireframes & UI Features

This document outlines the UI flow and feature set for the 3 main Front-ends of the Production Management System.

## 1. Centralized Task Management (Web Admin)
**Target Users:** Admin, Manager, Supervisor
**Platform:** Desktop Web Browser

### Screens:
- **Login screen:** Standard Username & Password + "Remember me" option.
- **Dashboard (Overview):**
  - Total active projects vs. completed.
  - Quick view of "Critical" status issues.
  - Recent activity logs.
- **Project Management:**
  - **List View:** Table displaying ID, Name, Status, Start/End Date, Progress Bar.
  - **Detail View:** Shows specific project info and a list of related tasks. Add/Edit button.
- **Task Management:**
  - **List View:** Table of tasks with filters (e.g., Assigned To, Priority, Status).
  - **Print QR/Barcode:** Dedicated UI to batch-print or individual-print Job Codes to attach to the physical work orders.
- **User/Role Management:**
  - Manage application access and Employee PINs.

## 2. Employee Operation Application (Mobile App)
**Target Users:** Factory Operators, Employees
**Platform:** iOS / Android or PWA

### Screens:
- **Login Screen:** Simplified login using Employee ID or PIN (for fast access on the floor).
- **Main Action/Home Screen:** 
  - Large button: "Scan Job Code" (Opens device camera).
  - "My Tasks": List of tasks currently accepted or in progress by this user.
- **Task Detail (Post-scan):**
  - Displays what needs to be done.
  - **Status Controls (Big Buttons):**
    - [รับงาน - Accept]
    - [เริ่มงาน - Start] 
    - [พักเบรก - Pause] 
    - [เสร็จสิ้น - Complete]
  - **Report Button:** "รายงานปัญหา" (Report Issue) -> Leads to the issue form.
- **Issue Reporting Screen:**
  - Dropdown for issue type (Machine Breakdown, Quality Issue, etc.).
  - Text area for notes.
  - Button to take/upload a photo.

## 3. Real-time Monitoring Dashboard (Production Display System - PDS)
**Target Users:** Floor Managers, Executives
**Platform:** Large TV Screens / Smart Monitors on the Factory Floor

### Screens & Features:
- **Dark Mode / High Contrast Design:** Optimized for visibility from a distance.
- **Live Status Feed:** 
  - Visual grid of work stations or active projects.
  - Projects use a circular or horizontal progress bar.
- **Bottleneck Indicators:** 
  - Flashing red or yellow outlines indicate a workstation that has an active issue or is severely behind schedule.
- **Activity Ticker:** 
  - A bottom scrolling marquee or side panel showing real-time updates: *"Operator A completed Task X"*, *"Machine 3 reported issue"*.
- **Auto-Refresh:** Handled via WebSockets; the screen never needs to be manually refreshed.
