import { Route, Routes } from 'react-router-dom';
import { Home } from './screens/Home.tsx';
import { Coordinator } from './screens/Coordinator.tsx';
import { Audience } from './screens/Audience.tsx';
import { Pit } from './screens/Pit.tsx';
import { Judges } from './screens/Judges.tsx';
import { ReplayCam } from './screens/ReplayCam.tsx';
import { PhoneSetup } from './screens/PhoneSetup.tsx';
import { PrintAwards, PrintCertificates, PrintHeats, PrintLabels, PrintResults, PrintRetrospective, PrintRoster, PrintStandings } from './screens/Print.tsx';
import { Vote } from './screens/Vote.tsx';
import { Notices } from './components/Notices.tsx';
import { Feedback } from './components/Feedback.tsx';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/coordinator/*" element={<Coordinator />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/pit" element={<Pit />} />
        <Route path="/pit/:carId" element={<Pit />} />
        <Route path="/judges" element={<Judges />} />
        <Route path="/replay" element={<ReplayCam />} />
        <Route path="/phone" element={<PhoneSetup />} />
        <Route path="/vote" element={<Vote />} />
        <Route path="/print/heats/:roundId" element={<PrintHeats />} />
        <Route path="/print/standings/:roundId" element={<PrintStandings />} />
        <Route path="/print/awards" element={<PrintAwards />} />
        <Route path="/print/roster" element={<PrintRoster />} />
        <Route path="/print/labels" element={<PrintLabels />} />
        <Route path="/print/retrospective" element={<PrintRetrospective />} />
        <Route path="/print/results" element={<PrintResults />} />
        <Route path="/print/certificates" element={<PrintCertificates />} />
      </Routes>
      <Notices />
      <Feedback />
    </>
  );
}
