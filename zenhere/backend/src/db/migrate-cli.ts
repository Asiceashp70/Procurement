import { config } from '../config/config';
import { migrate } from './migrate';

migrate(config().DATABASE_URL)
  .then(() => console.log('migrations up to date'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
