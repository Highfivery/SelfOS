import styles from './Home.module.css';

export function Home(): JSX.Element {
  return (
    <section className={styles.home} aria-labelledby="home-heading">
      <p className={styles.eyebrow}>SelfOS</p>
      <h1 id="home-heading" className={styles.heading}>
        A calm space for yourself
      </h1>
      <p className={styles.lede}>
        Reflect, set intentions, and check in with yourself. Your words stay yours — kept as plain
        files in a place you choose.
      </p>
      <blockquote className={styles.quote}>
        “Almost everything will work again if you unplug it for a few minutes — including you.”
      </blockquote>
    </section>
  );
}
