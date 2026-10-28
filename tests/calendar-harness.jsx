import React from 'react';import {createRoot} from 'react-dom/client';import ResidentCalendar,{UpcomingCalendar} from '../src/features/ResidentCalendar';
import '../src/tokens.css';import '../src/styles.css';import '../src/resident.css';import '../src/residentCorner.css';
const role=new URLSearchParams(location.search).get('role')||'admin';
createRoot(document.getElementById('root')).render(role==='upcoming'?<UpcomingCalendar userId="fixture-resident" onOpenCalendar={()=>{}}/>:<ResidentCalendar user={{id:`fixture-${role}`,role}} onNavigate={value=>{document.body.dataset.destination=value;}}/>);
