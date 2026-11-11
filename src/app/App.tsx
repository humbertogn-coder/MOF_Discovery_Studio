import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CompareProvider } from './CompareContext';
import { DataProvider } from './DataContext';
import Layout from './Layout';
import Home from '../pages/Home';
import Explorer from '../pages/Explorer';
import CandidateDetail from '../pages/CandidateDetail';
import NotFound from '../pages/NotFound';
import { Loading } from '../components/ui';

const Compare = lazy(() => import('../pages/Compare'));
const ActiveLearning = lazy(() => import('../pages/ActiveLearning'));
const Methods = lazy(() => import('../pages/Methods'));

export default function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <DataProvider>
      <CompareProvider>
        <BrowserRouter basename={basename}>
          <Suspense fallback={<Loading what="page" />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="explore" element={<Explorer />} />
                <Route path="candidate/:slug" element={<CandidateDetail />} />
                <Route path="compare" element={<Compare />} />
                <Route path="active-learning" element={<ActiveLearning />} />
                <Route path="methods" element={<Methods />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </CompareProvider>
    </DataProvider>
  );
}
